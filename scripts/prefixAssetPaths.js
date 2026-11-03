const ASSET_PATH = /(\(|["'`])(\/(?:images|icons|fonts|programdata|externalimages)\/)/g;

function prefixAssetPaths(text, base) {
  if (!base) {
    return text;
  }
  const normalized = base.endsWith("/") ? base.slice(0, -1) : base;
  return text.replace(ASSET_PATH, (_match, lead, path) => `${lead}${normalized}${path}`);
}

module.exports = { prefixAssetPaths };
