import Redacted from "./Redacted";

/// Renders whatever a buyer actually paid for. Text keeps the redaction burn-in, because that is
/// the unlock moment; a video or image just plays, since a clip of the trick being performed is the
/// thing a runner most wants to see.
export default function UnlockedContent({ unlocked }) {
  if (unlocked.status !== "ready") return null;

  const { kind, url, text, name, type, size } = unlocked;
  const kb = size != null ? `${(size / 1024).toFixed(1)} KB` : null;

  if (kind === "text" || (!url && text != null)) {
    return <Redacted text={text ?? ""} revealed lines={6} />;
  }

  return (
    <div className="unlocked-media">
      {kind === "video" && <video src={url} controls playsInline preload="metadata" />}
      {kind === "image" && <img src={url} alt={name} />}
      {kind === "audio" && <audio src={url} controls />}
      {kind === "file" && (
        <div className="file-drop">
          <b>{name}</b>
          <span>{type}</span>
        </div>
      )}
      <div className="media-foot">
        <span>{name}{kb ? ` · ${kb}` : ""}</span>
        {/* Opened in a tab rather than offered as a download: the blob is already decrypted in
            memory here, and a link keeps it out of any server round trip. */}
        <a href={url} target="_blank" rel="noreferrer">open full size</a>
      </div>
    </div>
  );
}
