import SilkBackground from "@/components/SilkBackground";

/** Dim silk behind a document or pricing header, fading into the page. */
export default function DocGlow() {
  return (
    <div className="doc-glow" aria-hidden="true">
      <SilkBackground intensity={.62} shade={.35} />
    </div>
  );
}
