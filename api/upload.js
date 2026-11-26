const { readSession } = require("../lib/common");

// Dosya yükleme izni verir: sadece giriş yapmış kullanıcı, sadece kendi klasörüne,
// sadece foto/video, en fazla 50 MB.
module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "bad_input" });
    const { handleUpload } = await import("@vercel/blob/client");
    const out = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const s = await readSession(req);
        if (!s) throw new Error("auth");
        if (!pathname.startsWith("tickets/" + s.username + "/") || pathname.includes("..")) throw new Error("path");
        return {
          allowedContentTypes: [
            "image/jpeg", "image/png", "image/webp", "image/gif",
            "video/mp4", "video/webm", "video/quicktime",
          ],
          maximumSizeInBytes: 50 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ u: s.username }),
        };
      },
      onUploadCompleted: async () => {},
    });
    return res.status(200).json(out);
  } catch (e) {
    console.error("[upload]", e && e.message ? e.message : "hata");
    return res.status(400).json({ error: "upload" });
  }
};
