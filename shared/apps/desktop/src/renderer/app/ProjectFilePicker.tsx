export type ProjectFileOption = {
  id: string;
  logicalName?: string;
  originalName?: string;
  relativePath?: string;
  storageKey?: string;
  mimeType?: string;
};

function fileLabel(file: ProjectFileOption): string {
  return file.logicalName || file.originalName || file.relativePath || file.storageKey || file.id;
}

/** Shared project-file selector used by workspace programs; selection stays project-scoped. */
export function ProjectFilePicker(props: {
  files: ProjectFileOption[];
  value: string;
  onChange: (fileId: string) => void;
  emptyLabel?: string;
  testId?: string;
  accept?: (file: ProjectFileOption) => boolean;
}) {
  const visible = props.accept ? props.files.filter(props.accept) : props.files;
  return (
    <select
      data-testid={props.testId || "brain-project-file-picker"}
      aria-label={props.emptyLabel || "选择项目文件"}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      <option value="">{props.emptyLabel || "选择项目文件"}</option>
      {visible.map((file) => (
        <option key={file.id} value={file.id}>{fileLabel(file)}</option>
      ))}
    </select>
  );
}
