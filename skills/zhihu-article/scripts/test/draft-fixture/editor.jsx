import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ContentState, Editor, EditorState, convertFromRaw, convertToRaw } from "draft-js";

const STORE = "zhihu-draft-fixture-v1";

function initialState() {
  const saved = localStorage.getItem(STORE);
  if (saved) return EditorState.createWithContent(convertFromRaw(JSON.parse(saved)));
  return EditorState.createWithContent(ContentState.createFromText("这是导语\n这是导语\n别的段落"));
}

function App() {
  const [title, setTitle] = useState(() => localStorage.getItem(`${STORE}:title`) || "技能验收测试草稿");
  const [editorState, setEditorState] = useState(initialState);

  function commit(next) {
    localStorage.setItem(STORE, JSON.stringify(convertToRaw(next.getCurrentContent())));
    setEditorState(next);
  }

  useEffect(() => {
    window.__fixture = {
      plain: () => editorState.getCurrentContent().getPlainText("\n"),
      title: () => title,
      blockCount: () => editorState.getCurrentContent().getBlockMap().size,
      rerender: () => commit(EditorState.forceSelection(editorState, editorState.getSelection())),
    };
  });

  return (
    <div>
      <textarea
        id="title"
        placeholder="请输入标题（最多 100 个字）"
        value={title}
        onChange={(event) => {
          localStorage.setItem(`${STORE}:title`, event.target.value);
          setTitle(event.target.value);
        }}
      />
      <Editor editorState={editorState} onChange={commit} />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
