// Vercel serverless function. Fetches Reddit's public, unauthenticated
// hot.json endpoint server-side, where CORS does not apply (CORS is a
// browser-only restriction), and hands the JSON back to the page at the
// same origin. No API keys, no cost beyond Vercel's free tier.
module.exports = async (req, res) => {
  const rawSub = typeof req.query.sub === "string" ? req.query.sub : "popular";
  const sub = rawSub.replace(/[^a-zA-Z0-9_]/g, "") || "popular";

  try {
    const upstream = await fetch(
      "https://www.reddit.com/r/" + sub + "/hot.json?limit=15&raw_json=1",
      {
        headers: {
          "User-Agent": "fruit-fly-connectome-reddit-simulator/1.0",
        },
      }
    );

    if (!upstream.ok) {
      res.status(upstream.status).json({ error: "Reddit responded " + upstream.status });
      return;
    }

    const data = await upstream.json();
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=120");
    res.status(200).json(data);
  } catch (err) {
    res.status(502).json({
      error: "Upstream fetch failed",
      message: (err && err.message) || String(err),
    });
  }
};
