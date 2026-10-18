// Shared provider upload capability probe; site DOM stays in providers/.
const elioProviderMedia = {
  nativeVideo(provider) {
    // These providers document native video attachments. Their upload result
    // still decides success; account/platform restrictions can reject a file.
    if(['chatgpt','gemini'].includes(provider.id))return true;
    return [...document.querySelectorAll('input[type="file"]')].some(input=>/video\/|\.(mp4|webm|mov)(?:[,\s]|$)/i.test(input.accept));
  }
};
