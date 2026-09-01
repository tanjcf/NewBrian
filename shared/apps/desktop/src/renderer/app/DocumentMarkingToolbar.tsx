import type { AnnotationMarkingTool } from "@codex-forge/protocol";
import { ANNOTATION_MARKING_COLORS } from "@codex-forge/protocol";

export function DocumentMarkingToolbar(props: {
  active: boolean;
  tool: AnnotationMarkingTool;
  color: string;
  onToolChange: (tool: AnnotationMarkingTool) => void;
  onColorChange: (color: string) => void;
}) {
  if (!props.active) return null;
  return (
    <div className="document-marking-toolbar" aria-label="标记工具">
      <div className="document-marking-tools" role="toolbar" aria-label="标记模式">
        <button
          type="button"
          className={props.tool === "select-rect" ? "active" : ""}
          aria-pressed={props.tool === "select-rect"}
          title="框选"
          onClick={() => props.onToolChange("select-rect")}
        >
          框选
        </button>
      </div>
      <div className="document-marking-colors" aria-label="标记颜色">
        {ANNOTATION_MARKING_COLORS.map((entry) => (
          <button
            type="button"
            key={entry}
            className={props.color === entry ? "active" : ""}
            aria-label={`颜色 ${entry}`}
            aria-pressed={props.color === entry}
            style={{ backgroundColor: entry }}
            onClick={() => props.onColorChange(entry)}
          />
        ))}
      </div>
    </div>
  );
}
