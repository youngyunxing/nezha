import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { loadLanguageExtension } from "../components/file-viewer/languageExtensions";

describe("file viewer language extensions", () => {
  it("parses Vue SFC template, TypeScript, and style sections", async () => {
    const extension = await loadLanguageExtension("Component.VUE");
    const state = EditorState.create({
      doc: `<template><p>{{ message }}</p></template>
<script setup lang="ts">const count: number = 1</script>
<style>.message { color: red }</style>`,
      extensions: [extension],
    });
    // 没有 EditorView 时语法树是懒解析的：直接读 syntaxTree 拿到的可能只是半截
    // （并跑测试时机器一忙就翻）。ensureSyntaxTree 会把它解析完再返回。
    const tree = (ensureSyntaxTree(state, state.doc.length, 5000) ?? syntaxTree(state)).toString();

    expect(tree).toContain("Interpolation");
    expect(tree).toContain("TypeAnnotation");
    expect(tree).toContain("StyleSheet");
  });
});
