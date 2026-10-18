// Shared provider upload capability probe; site DOM stays in providers/.
function safeQueryAll(root, selector) {
  try { return Array.from(root.querySelectorAll(selector)); } catch { return []; }
}
const elioProviderMedia = {
  nativeVideo(provider) {
    // These providers document native video attachments. Their upload result
    // still decides success; account/platform restrictions can reject a file.
    if(['chatgpt','gemini'].includes(provider.id))return true;
    return safeQueryAll(document, 'input[type="file"]').some(input => {
      try { return /video\/|\.(mp4|webm|mov)(?:[,\s]|$)/i.test(input.accept); } catch { return false; }
    });
  }
};
