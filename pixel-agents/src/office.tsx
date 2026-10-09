import { useEffect, useRef } from "react";
import { OfficeState } from "../vendor/webview-ui/src/office/engine/officeState";
import { renderFrame } from "../vendor/webview-ui/src/office/engine/renderer";
import { startGameLoop } from "../vendor/webview-ui/src/office/engine/gameLoop";
import { setCharacterTemplates } from "../vendor/webview-ui/src/office/sprites/spriteData";
import { setFloorSprites } from "../vendor/webview-ui/src/office/floorTiles";
import { setWallSprites } from "../vendor/webview-ui/src/office/wallTiles";
import { setCarpetSprites } from "../vendor/webview-ui/src/office/sprites/carpetTiles";
import { buildDynamicCatalog } from "../vendor/webview-ui/src/office/layout/furnitureCatalog";
import assets from "./assets.json";
import originalLayout from "../vendor/webview-ui/public/assets/default-layout-1.json";
import { activityOf } from "./activity.mjs";

let initialized = false;
export function createOffice() {
  if (!initialized) {
    setCharacterTemplates(assets.characters);
    setFloorSprites(assets.floors);
    setWallSprites(assets.walls);
    setCarpetSprites(assets.carpets);
    buildDynamicCatalog(assets.furniture);
    initialized = true;
  }
  const layout = structuredClone(originalLayout) as any;
  // The upstream layout reserves ten empty rows above the room; crop them.
  layout.rows -= 10;
  for (const k of ["tiles", "tileColors", "carpetTiles", "areaTiles"])
    if (layout[k]) layout[k] = layout[k].slice(10 * layout.cols);
  for (const f of layout.furniture) f.row -= 10;
  return new OfficeState(layout);
}

export function Office({
  conversations,
  events,
  selected,
  onSelect,
  zoom,
  paused,
  expanded,
}: {
  [key: string]: any;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<OfficeState | null>(null);
  if (!stateRef.current) stateRef.current = createOffice();
  const ids = useRef(new Map<string, number>());
  const nextId = useRef(1);
  const liveRef = useRef({
    conversations,
    events,
    selected,
    onSelect,
    zoom,
    paused,
    expanded,
  });
  liveRef.current = {
    conversations,
    events,
    selected,
    onSelect,
    zoom,
    paused,
    expanded,
  };
  useEffect(() => {
    const os = stateRef.current!;
    const keep = new Set(conversations.map((c: any) => c.id));
    for (const [cid, id] of ids.current)
      if (!keep.has(cid)) {
        os.removeAgent(id);
        ids.current.delete(cid);
      }
    for (const c of conversations) {
      if (!ids.current.has(c.id)) {
        const id = nextId.current++;
        ids.current.set(c.id, id);
        os.addAgent(
          id,
          undefined,
          undefined,
          undefined,
          false,
          (c.workspace?.working_dir ?? "").split("/").pop(),
        );
      }
      const id = ids.current.get(c.id)!;
      const a = activityOf(c, events[c.id] ?? []);
      if (os.characters.get(id)?.isActive !== a.running)
        os.setAgentActive(id, a.running);
      os.setAgentTool(id, a.animationTool);
      if (a.waiting) os.showPermissionBubble(id);
      else os.clearPermissionBubble(id);
    }
    os.selectedAgentId = ids.current.get(selected) ?? null;
  }, [conversations, events, selected]);
  useEffect(() => {
    const canvas = canvasRef.current!;
    const os = stateRef.current!;
    let projection = { offsetX: 0, offsetY: 0, scale: 1 };
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const d = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * d);
      canvas.height = Math.round(r.height * d);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    const stop = startGameLoop(canvas, {
      update: (dt) => {
        if (!liveRef.current.paused) os.update(dt);
      },
      render: (ctx) => {
        const l = os.getLayout();
        const fit = Math.min(
          canvas.width / (l.cols * 16 + 32),
          canvas.height / (l.rows * 16 + (liveRef.current.expanded ? 24 : 64)),
        );
        const z = Math.max(0.7, fit) * liveRef.current.zoom;
        const p = renderFrame(
          ctx,
          canvas.width,
          canvas.height,
          os.tileMap,
          os.furniture,
          os.getCharacters(),
          z,
          0,
          0,
          {
            selectedAgentId: os.selectedAgentId,
            hoveredAgentId: os.hoveredAgentId,
            hoveredTile: null,
            seats: os.seats,
            characters: os.characters,
          },
          undefined,
          l.tileColors,
          l.cols,
          l.rows,
          l.carpetTiles,
          l.areas,
          l.areaTiles,
          false,
          null,
          os.pets,
        );
        projection = { ...p, scale: z };
        const ordered = [...liveRef.current.conversations].sort(
          (a: any, b: any) =>
            Number(a.id === liveRef.current.selected) -
            Number(b.id === liveRef.current.selected),
        );
        for (const c of ordered) {
          const id = ids.current.get(c.id);
          const ch = id === undefined ? null : os.characters.get(id);
          if (!ch) continue;
          const a = activityOf(c, liveRef.current.events[c.id] ?? []);
          const expanded =
            c.id === liveRef.current.selected || id === os.hoveredAgentId;
          const title = (c.title ?? `Agent ${c.id.slice(0, 6)}`).replace(
            /^[^\p{L}\p{N}]+/u,
            "",
          );
          const label = title.slice(0, expanded ? 23 : 12);
          ctx.font = `${Math.max(10, Math.round(z * 3))}px ui-monospace,monospace`;
          ctx.textAlign = "center";
          const x = p.offsetX + ch.x * z;
          const y = p.offsetY + (ch.y - 31) * z;
          const w = ctx.measureText(label).width + 18;
          ctx.fillStyle =
            c.id === liveRef.current.selected ? "#dbf59b" : "#182333ee";
          ctx.fillRect(x - w / 2, y - 14, w, 20);
          ctx.fillStyle =
            c.id === liveRef.current.selected
              ? "#182333"
              : a.running
                ? "#b4e879"
                : "#dbe4ed";
          ctx.fillText(label, x, y);
        }
      },
    });
    const point = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      const d = window.devicePixelRatio || 1;
      return {
        x: ((e.clientX - r.left) * d - projection.offsetX) / projection.scale,
        y: ((e.clientY - r.top) * d - projection.offsetY) / projection.scale,
      };
    };
    const click = (e: MouseEvent) => {
      const p = point(e);
      const id = os.getCharacterAt(p.x, p.y);
      const cid = [...ids.current].find(([, v]) => v === id)?.[0];
      if (cid) liveRef.current.onSelect(cid);
    };
    const move = (e: MouseEvent) => {
      const p = point(e);
      os.hoveredAgentId = os.getCharacterAt(p.x, p.y);
      canvas.style.cursor = os.hoveredAgentId !== null ? "pointer" : "default";
    };
    canvas.addEventListener("click", click);
    canvas.addEventListener("mousemove", move);
    return () => {
      stop();
      ro.disconnect();
      canvas.removeEventListener("click", click);
      canvas.removeEventListener("mousemove", move);
    };
  }, []);
  return (
    <canvas
      ref={canvasRef}
      aria-label="Pixel office showing live OpenHands conversations"
      role="img"
    />
  );
}
