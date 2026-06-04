const express = require("express");
const { simulateTagMatch } = require("./tagSimulation");

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json({ limit: process.env.JSON_LIMIT ?? "25mb" }));

app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
});

app.post("/api/tag-v1/simulate", async (request, response) => {
    try {
        response.json(await simulateTagMatch(request.body));
    } catch (error) {
        response.status(400).json({
            status: "FAILED",
            result: "ERROR",
            message: error.message,
        });
    }
});

app.listen(port, () => {
    console.log(`[ml-server] listening on ${port}`);
});
