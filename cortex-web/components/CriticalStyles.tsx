// A small, server-rendered safety net for browsers that fail to fetch a Next.js
// stylesheet (for example, an interrupted in-app browser/CDN request).
// Keep this limited to readable navigation and forms; globals.css owns the design.
// :where() gives every fallback rule zero specificity, so the normal CSS wins.
export const criticalStyles = `
:where(:root){color-scheme:dark}
:where(*),:where(*::before),:where(*::after){box-sizing:border-box}
:where(html){max-width:100%;overflow-x:hidden}
:where(body){margin:0;min-width:0;background:#050505;color:#f7f7f7;font-family:Arial,"Segoe UI",sans-serif;line-height:1.45}
:where(a){color:inherit;text-decoration:none}
:where(button),:where(input){font:inherit}
:where(button){cursor:pointer}
:where(h1),:where(h2),:where(p){margin:0}
:where(img),:where(svg){max-width:100%}
:where(:focus-visible){outline:2px solid #f7f7f7;outline-offset:3px}
:where(.brand){display:inline-flex;align-items:center;gap:12px;white-space:nowrap;font-weight:750;letter-spacing:.1em}
:where(.brand img){width:33px;height:33px;object-fit:contain}
:where(.button){display:inline-flex;align-items:center;justify-content:center;gap:12px;min-height:48px;padding:12px 20px;border:1px solid #393939;border-radius:12px;background:#1c1c1c;color:#f6f6f6;text-align:center;font-weight:650}
:where(.button--primary){background:#f5f5f5;border-color:#f5f5f5;color:#101010}
:where(.shell){min-height:100svh;width:100%;min-width:0;display:flex;flex-direction:column;background:#080808}
:where(.site-header),:where(.site-footer){display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:20px;padding:25px clamp(20px,5vw,70px)}
:where(.site-header>*),:where(.site-footer>*){min-width:0;max-width:100%}
:where(.footer-merchant),:where(.footer-links){display:flex;flex-wrap:wrap;gap:10px;min-width:0;max-width:100%;overflow-wrap:anywhere}
:where(.footer-merchant){flex-direction:column;align-items:flex-start}
:where(.footer-links a){display:inline-flex;align-items:center;gap:5px;max-width:100%;overflow-wrap:anywhere}
:where(.hero){flex:1;min-width:0;width:100%;display:grid;grid-template-columns:minmax(0,1fr);place-items:center;padding:65px 22px;text-align:center}
:where(.hero-copy){width:100%;min-width:0;max-width:920px;margin:auto;overflow-wrap:anywhere}
:where(.hero h1){font-size:clamp(36px,9vw,72px);line-height:1.08;letter-spacing:-.05em}
:where(.hero-description){margin:20px auto;color:#aaa;font-size:15px;line-height:1.7;max-width:600px}
:where(.hero-actions){display:flex;justify-content:center;flex-wrap:wrap;gap:12px;margin-top:28px}
:where(.auth-page){min-height:100svh;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr auto;grid-template-areas:"auth-header" "auth-main" "auth-footer";background:#080808}
:where(.auth-header){grid-area:auth-header;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:28px clamp(20px,5vw,56px)}
:where(.auth-back){display:inline-flex;align-items:center;gap:8px;color:#b5b5b5;font-size:12px}
:where(.auth-main){grid-area:auth-main;display:flex;align-items:center;min-width:0;padding:30px clamp(20px,5vw,56px) 50px}
:where(.auth-form-area){width:100%;max-width:430px;margin-inline:auto}
:where(.auth-kicker){margin-bottom:20px;color:#a5a5a5;font-size:10px;font-weight:700;letter-spacing:.14em}
:where(.auth-form-area h1){color:#f8f8f8;font-size:clamp(33px,8vw,52px);line-height:1.12;letter-spacing:-.05em}
:where(.auth-description){margin:16px 0 26px;color:#a4a4a4;font-size:14px;line-height:1.65}
:where(.auth-mode-tabs){display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}
:where(.auth-mode-tabs button){border:1px solid #454545;border-radius:10px;background:#1b1b1b;color:#f0f0f0;padding:11px 15px}
:where(.registration-form){display:flex;flex-direction:column;gap:12px}
:where(.registration-form>label:not(.form-check)){font-size:12px;color:#d0d0d0;margin-top:5px}
:where(.registration-form>input){width:100%;min-width:0;height:52px;padding:0 16px;border:1px solid #454545;border-radius:12px;background:#171717;color:#fff;font-size:14px}
:where(.otp-code){display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:5px}
:where(.otp-code .otp-digit){width:100%;min-width:0;height:52px;border:1px solid #454545;border-radius:9px;background:#171717;color:#fff;text-align:center;font-size:21px}
:where(.form-check){display:flex;align-items:flex-start;gap:10px;color:#b8b8b8;font-size:12px;line-height:1.5;position:relative;margin-top:5px}
:where(.form-check input){position:absolute;top:0;left:0;width:20px;height:20px;opacity:0}
:where(.custom-check){display:grid;place-items:center;flex:0 0 20px;width:20px;height:20px;border:1px solid #777;border-radius:5px;background:#161616}
:where(.custom-check svg){opacity:0}
:where(.form-check input:checked+.custom-check){background:#fff;color:#111}
:where(.form-check input:checked+.custom-check svg){opacity:1}
:where(.form-check a){text-decoration:underline}
:where(.auth-submit){width:100%;min-height:52px;margin-top:16px}
:where(.form-error){padding:12px;border:1px solid #704040;border-radius:10px;color:#ffb9b9;background:#281919}
:where(.auth-switch),:where(.auth-legal-note),:where(.auth-otp-hint){margin-top:15px;color:#aaa;font-size:12px;line-height:1.6}
:where(.auth-switch button),:where(.auth-resend),:where(.auth-code-switch){background:transparent;border:0;color:#eee;padding:6px}
:where(.auth-footer){grid-area:auth-footer;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;padding:22px clamp(20px,5vw,56px);color:#999;font-size:11px}
:where(.auth-footer-links){display:flex;flex-wrap:wrap;gap:14px}
:where(.auth-art){display:none}
:where(.auth-success){max-width:430px;margin:auto;text-align:center}
:where(.legal-page){max-width:900px;min-height:100svh;margin:auto;padding:45px 24px 90px;color:#f7f7f7;line-height:1.65}
:where(.legal-page h1){font-size:clamp(32px,8vw,52px);line-height:1.15;margin:30px 0}
:where(.legal-page h2){font-size:22px;margin:30px 0 12px}
@media(max-width:600px){:where(.auth-main){align-items:flex-start;padding-top:45px}:where(.auth-header){padding-top:22px}:where(.auth-footer){padding-bottom:32px}:where(.hero-actions){display:grid;grid-template-columns:minmax(0,1fr)}:where(.hero-actions .button){width:100%}}
`;

export default function CriticalStyles() {
  // Only static source-controlled CSS is embedded; no user input is interpolated.
  return <style id="cortex-critical-styles" dangerouslySetInnerHTML={{ __html: criticalStyles }} />;
}
