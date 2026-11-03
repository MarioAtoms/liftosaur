const Jimp = require("jimp");
const path = require("path");

const root = path.join(__dirname, "..");
const banner = 0x5b21b6ff;

async function paint(size, dest) {
  const icon = await Jimp.read(path.join(root, "icons/icon512.png"));
  icon.resize(size, size);
  const bandHeight = Math.round(size * 0.22);
  const band = new Jimp(size, bandHeight, banner);
  icon.composite(band, 0, size - bandHeight);
  const fontSize = size >= 512 ? Jimp.FONT_SANS_64_WHITE : Jimp.FONT_SANS_32_WHITE;
  const font = await Jimp.loadFont(fontSize);
  const label = "MARIO";
  const textHeight = size >= 512 ? 64 : 32;
  const y = size - bandHeight + Math.round((bandHeight - textHeight) / 2);
  icon.print(font, 0, y, { text: label, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER }, size);
  await icon.writeAsync(path.join(root, dest));
}

async function main() {
  await paint(512, "fork/icons/icon512.png");
  await paint(512, "fork/icons/maskable_icon_512.png");
  await paint(192, "fork/icons/icon192.png");
  await paint(32, "fork/icons/favicon-32x32.png");
  await paint(16, "fork/icons/favicon-16x16.png");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
