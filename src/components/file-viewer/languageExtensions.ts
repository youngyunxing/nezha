import { useEffect, useState } from "react";
import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

const fileNameLanguages: Record<string, string> = {
  dockerfile: "dockerfile",
  "dockerfile.dev": "dockerfile",
  "dockerfile.prod": "dockerfile",
  makefile: "shell",
  gnumakefile: "shell",
  justfile: "shell",
  gemfile: "ruby",
  rakefile: "ruby",
  vagrantfile: "ruby",
  procfile: "shell",
  "cmakelists.txt": "shell",
  ".gitignore": "shell",
  ".dockerignore": "shell",
  ".env": "shell",
  ".env.local": "shell",
  ".env.example": "shell",
  ".npmrc": "toml",
  ".yarnrc": "yaml",
  "changelog.md": "markdown",
  readme: "markdown",
};

export async function loadLanguageExtension(fileName: string): Promise<Extension> {
  const lower = fileName.toLowerCase();
  const language = fileNameLanguages[lower] ?? getFileExtension(lower);

  switch (language) {
    case "ts":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "tsx":
      return (await import("@codemirror/lang-javascript")).javascript({
        jsx: true,
        typescript: true,
      });
    case "js":
    case "mjs":
    case "cjs":
      return (await import("@codemirror/lang-javascript")).javascript();
    case "jsx":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true });
    case "json":
    case "jsonc":
      return (await import("@codemirror/lang-json")).json();
    case "rs":
      return (await import("@codemirror/lang-rust")).rust();
    case "html":
    case "htm":
      return (await import("@codemirror/lang-html")).html();
    case "css":
    case "scss":
    case "sass":
      return (await import("@codemirror/lang-css")).css();
    case "md":
    case "mdx":
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "yaml":
    case "yml":
      return (await import("@codemirror/lang-yaml")).yaml();
    case "py":
      return (await import("@codemirror/lang-python")).python();
    case "go":
      return (await import("@codemirror/lang-go")).go();
    case "java":
      return (await import("@codemirror/lang-java")).java();
    case "c":
    case "h":
    case "cpp":
    case "cc":
    case "hpp":
      return (await import("@codemirror/lang-cpp")).cpp();
    case "sql":
      return (await import("@codemirror/lang-sql")).sql();
    case "xml":
      return (await import("@codemirror/lang-xml")).xml();
    case "vue":
      return (await import("@codemirror/lang-vue")).vue();
    case "dockerfile": {
      const { dockerFile } = await import("@codemirror/legacy-modes/mode/dockerfile");
      return StreamLanguage.define(dockerFile);
    }
    case "toml": {
      const { toml } = await import("@codemirror/legacy-modes/mode/toml");
      return StreamLanguage.define(toml);
    }
    case "ruby":
    case "rb": {
      const { ruby } = await import("@codemirror/legacy-modes/mode/ruby");
      return StreamLanguage.define(ruby);
    }
    case "lua": {
      const { lua } = await import("@codemirror/legacy-modes/mode/lua");
      return StreamLanguage.define(lua);
    }
    case "swift": {
      const { swift } = await import("@codemirror/legacy-modes/mode/swift");
      return StreamLanguage.define(swift);
    }
    case "kt": {
      const { kotlin } = await import("@codemirror/legacy-modes/mode/clike");
      return StreamLanguage.define(kotlin);
    }
    case "cs":
    case "csx": {
      const { csharp } = await import("@codemirror/legacy-modes/mode/clike");
      return StreamLanguage.define(csharp);
    }
    case "r": {
      const { r } = await import("@codemirror/legacy-modes/mode/r");
      return StreamLanguage.define(r);
    }
    case "sh":
    case "bash":
    case "zsh":
    case "fish":
    case "proto":
    case "shell": {
      const { shell } = await import("@codemirror/legacy-modes/mode/shell");
      return StreamLanguage.define(shell);
    }
    default:
      return [];
  }
}

export function useLanguageExtension(fileName: string): Extension {
  const [extension, setExtension] = useState<Extension>([]);

  useEffect(() => {
    let cancelled = false;
    setExtension([]);
    void loadLanguageExtension(fileName)
      .then((loaded) => {
        if (!cancelled) setExtension(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled && import.meta.env.DEV) {
          console.error("[file-viewer] Failed to load syntax highlighting", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fileName]);

  return extension;
}
