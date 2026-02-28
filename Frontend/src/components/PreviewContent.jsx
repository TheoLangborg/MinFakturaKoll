export default function PreviewContent({ file, large = false }) {
  const imageClass = large ? "preview-image-large" : "preview-image";
  const pdfClass = large ? "preview-pdf-large" : "preview-pdf";
  const textClass = large ? "preview-text-large" : "preview-text";

  if (file.previewKind === "image") {
    return <img className={imageClass} src={file.previewSrc} alt={`Förhandsvisning av ${file.name}`} />;
  }

  if (file.previewKind === "pdf") {
    return <iframe className={pdfClass} src={file.previewSrc} title={`PDF-förhandsvisning: ${file.name}`} />;
  }

  if (file.previewKind === "text") {
    return <pre className={textClass}>{file.textPreview}</pre>;
  }

  return (
    <div className="input-placeholder">
      <p>Den här filtypen kan inte förhandsvisas.</p>
    </div>
  );
}
