import {
  CAPTURED_CREATE_TWEET_QUERY_ID,
  CAPTURED_FEATURES,
  CAPTURED_QUERY_SOURCE,
  HOME_URL,
  HOW_TO_LOGIN,
  HOW_TO_LOGIN_ZH,
  LOGIN_TIP,
  LOGIN_TIP_ZH,
  SKILL,
  SPACE_NAME,
  buildCreateTweetBody,
  buildHeaders,
  classifyLogin,
  confirmationSummary,
  createTweetUrl,
  extractCreateTweetQueryId,
  extractScriptUrls,
  extractWebBearer,
  interpretCreateTweetResponse,
  isScreenName,
  needsRepaint,
  normalizeLanguage,
  rankScriptUrls,
  screenNameFromPath,
  statusUrl,
} from "./pure.mjs";

function loginStop(message) {
  return {
    ok: false,
    sent: false,
    logged_in: false,
    login_required: true,
    exitCode: 2,
    error: message,
    how_to_login: HOW_TO_LOGIN,
    how_to_login_zh: HOW_TO_LOGIN_ZH,
    login_tip: LOGIN_TIP,
    login_tip_zh: LOGIN_TIP_ZH,
  };
}

export async function resolveCreateTweetQuery(session, override) {
  if (override) return { queryId: override, source: "flag", bearer: "" };
  let html = "";
  try {
    html = await session.pageSource();
  } catch {
    html = "";
  }
  const urls = rankScriptUrls(extractScriptUrls(html));
  let bearer = extractWebBearer(html);
  let queryId = extractCreateTweetQueryId(html);
  for (const url of urls) {
    if (queryId && bearer) break;
    let source = "";
    try {
      source = await session.fetchText(url);
    } catch {
      continue;
    }
    if (!queryId) queryId = extractCreateTweetQueryId(source);
    if (!bearer) bearer = extractWebBearer(source);
  }
  if (!queryId) {
    return { queryId: CAPTURED_CREATE_TWEET_QUERY_ID, source: CAPTURED_QUERY_SOURCE, bearer };
  }
  return { queryId, source: "bundle", bearer };
}

export async function performPost(config, session) {
  if (!config || !config.yes) return confirmationSummary(config || {});
  await session.ensureSite();
  let detected = await session.detect();
  if (needsRepaint(detected)) {
    await session.goto(HOME_URL);
    detected = await session.detect();
  }
  const classified = classifyLogin(detected);
  const page = { url: detected.url, title: detected.title };
    if (!classified.logged_in) {
    if (config.keep) {
      try { await session.handOff(); } catch { /* handOff is optional */ }
    }
    return {
      ...loginStop("X login required in Ego Lite"),
      logged_in: false,
      login_required: true,
      on_login_page: classified.on_login_page,
      screen_name: classified.screen_name,
      page,
    };
  }
  const csrfToken = await session.csrfToken();
  if (!csrfToken) {
    if (config.keep) {
      try { await session.handOff(); } catch { /* handOff is optional */ }
    }
    return { ...loginStop("ct0 missing; sign in to x.com inside Ego Lite"), page };
  }
  const discovered = await resolveCreateTweetQuery(session, config.queryId);
  const url = createTweetUrl(discovered.queryId);
  if (!url) {
    return {
      ok: false,
      sent: false,
      exitCode: 1,
      error: "CreateTweet query id is not usable",
      query_id_source: discovered.source,
      page,
    };
  }
  const language = normalizeLanguage(detected.lang);
  const request = {
    url,
    headers: buildHeaders({ bearer: discovered.bearer, csrfToken, language }),
    body: buildCreateTweetBody({
      text: config.text,
      replyTo: config.replyTo,
      queryId: discovered.queryId,
      features: CAPTURED_FEATURES,
    }),
  };
  const response = await session.postJson(request);
  const parsed = interpretCreateTweetResponse(response.status, response.body, { replyTo: config.replyTo });
  if (!parsed.ok) {
    if (parsed.loginRequired) return { ...loginStop(parsed.error), page, http_status: response.status };
    return {
      ok: false,
      sent: false,
      exitCode: 1,
      error: parsed.error,
      http_status: response.status || undefined,
      query_id: discovered.queryId,
      query_id_source: discovered.source,
      reply_best_effort: Boolean(config.replyTo) || undefined,
      page,
    };
  }
  let screen = parsed.screenName;
  if (!isScreenName(screen) && typeof session.screenName === "function") {
    try {
      screen = screenNameFromPath(await session.screenName());
    } catch {
      screen = "";
    }
  }
  const status = statusUrl(screen, parsed.id);
  return {
    ok: true,
    sent: true,
    logged_in: true,
    login_required: false,
    exitCode: 0,
    url: status,
    status_id: parsed.id,
    screen_name: screen || undefined,
    query_id: discovered.queryId,
    query_id_source: discovered.source,
    reply_best_effort: Boolean(config.replyTo) || undefined,
    warning: config.replyTo
      ? "Reply via page.fetch was not verified. A capture on 2026-11-04 returned GraphQL 226."
      : undefined,
    page,
  };
}

export async function executePost(config, { browser } = {}) {
  if (!config || !config.yes) return confirmationSummary(config || {});
  const summary = {
    skill: SKILL,
    command: "post",
    ok: false,
    sent: false,
    exitCode: 1,
    login_tip: LOGIN_TIP,
    login_tip_zh: LOGIN_TIP_ZH,
  };
  let session;
  try {
    session = await browser.open({
      taskName: config.taskName || SPACE_NAME,
      startUrl: HOME_URL,
      keepBrowser: Boolean(config.keep),
    });
    summary.spaceId = session.spaceId;
    Object.assign(summary, await performPost(config, session));
  } catch (error) {
    summary.error = String(error && error.message ? error.message : error);
    summary.exitCode = 1;
    summary.ok = false;
    summary.sent = false;
  } finally {
    if (session) {
      try {
        await session.finish();
      } catch (error) {
        summary.finish_error = String(error && error.message ? error.message : error);
      }
    }
  }
  return summary;
}

export async function executeCleanup(config, { browser } = {}) {
  let session;
  try {
    session = await browser.open({
      taskName: (config && config.taskName) || SPACE_NAME,
      keepBrowser: false,
    });
    await session.cleanup();
    return {
      skill: SKILL,
      command: "cleanup",
      ok: true,
      exitCode: 0,
      spaceId: session.spaceId,
      kept: [],
    };
  } catch (error) {
    return {
      skill: SKILL,
      command: "cleanup",
      ok: false,
      exitCode: 1,
      error: String(error && error.message ? error.message : error),
    };
  }
}
