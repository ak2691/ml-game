import { Graphics, Rectangle } from "pixi.js";

const DEFAULT_TEXTURE_RESOLUTION = 1.5;

/**
 * Renderer-owned cache for vector art that is identical between frames.
 * Generated textures cannot outlive their renderer, so every Pixi arena owns
 * one of these and disposes it when that arena unmounts.
 */
export function createArenaTextureCache(renderer) {
    const textures = new Map();

    function get(key, frame, draw) {
        const cached = textures.get(key);
        if (cached) return cached;

        const source = new Graphics();
        draw(source);
        const texture = renderer.generateTexture({
            target: source,
            frame: frame instanceof Rectangle
                ? frame
                : new Rectangle(frame.x, frame.y, frame.width, frame.height),
            resolution: DEFAULT_TEXTURE_RESOLUTION,
            antialias: true,
        });
        source.destroy();
        textures.set(key, texture);
        return texture;
    }

    function destroy() {
        for (const texture of textures.values()) texture.destroy(true);
        textures.clear();
    }

    return { get, destroy, get size() { return textures.size; } };
}

export function centeredTextureFrame(radius) {
    const extent = Math.ceil(radius);
    return { x: -extent, y: -extent, width: extent * 2, height: extent * 2 };
}
