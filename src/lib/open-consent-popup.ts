/** Open a centered popup window for OAuth consent flows */
export function openConsentPopup(url: string) {
  const w = 600, h = 700;
  const left = window.screenX + (window.outerWidth - w) / 2;
  const top = window.screenY + (window.outerHeight - h) / 2;
  return window.open(
    url,
    "m365_consent",
    `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`
  );
}
