import { Component, ElementRef, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { ButtonComponent, CircularProgressComponent, InputComponent } from '@m1z23r/ngx-ui';
import { CardComponent } from '../card/card';
import { ICard, CardService } from '../../core/api/card.service';
import { CardTypeColorsService } from '../../core/api/card-type-colors.service';
import { WorkspaceService } from '../../core/workspace/workspace.service';
import { SnapContext, ISnapLine } from '../../core/snap';
import { RealtimeService, CardEvent } from '../../core/realtime/realtime.service';

export interface EdgeIndicator {
  x: number;
  y: number;
  color: string;
  edge: 'top' | 'bottom' | 'left' | 'right' | 'corner';
  cardId: string;
}

const COLORS = ['#fde68a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#ddd6fe', '#fed7aa'];

type Menu =
  | { kind: 'empty'; x: number; y: number; canvasX: number; canvasY: number }
  | { kind: 'card'; x: number; y: number; card: ICard }
  | null;

@Component({
  selector: 'app-canvas-board',
  standalone: true,
  imports: [CardComponent, ButtonComponent, CircularProgressComponent, InputComponent],
  templateUrl: './canvas-board.html',
  styleUrl: './canvas-board.css',
})
export class CanvasBoardComponent {
  private cards = inject(CardService);
  private snapCtx = inject(SnapContext);
  private colorsSvc = inject(CardTypeColorsService);
  private workspaces = inject(WorkspaceService);
  private realtime = inject(RealtimeService);
  readonly colors = COLORS;
  readonly list = signal<ICard[]>([]);
  readonly menu = signal<Menu>(null);
  readonly menuStep = signal<'type' | 'totp-form' | 'container-color' | 'password-form'>('type');
  readonly highlightedContainerId = signal<string | null>(null);
  totpFormName = '';
  totpFormSecret = '';
  passwordFormName = '';
  passwordFormValue = '';

  @ViewChild('board', { static: true }) board!: ElementRef<HTMLDivElement>;
  @ViewChild('fi') fi?: ElementRef<HTMLInputElement>;
  @ViewChild('cp') cp?: ElementRef<HTMLInputElement>;
  private colorPickerCallback: ((color: string) => void) | null = null;

  private static readonly VIEW_STORAGE_KEY = 'canvas-board-view';
  private static readonly MIN_SCALE = 0.1;
  private static readonly MAX_SCALE = 3;

  private static loadView(): { panX: number; panY: number; scale: number } {
    try {
      const raw = localStorage.getItem(CanvasBoardComponent.VIEW_STORAGE_KEY);
      if (!raw) return { panX: 0, panY: 0, scale: 1 };
      const v = JSON.parse(raw);
      const scale = Math.min(
        CanvasBoardComponent.MAX_SCALE,
        Math.max(CanvasBoardComponent.MIN_SCALE, Number(v.scale) || 1),
      );
      return { panX: Number(v.panX) || 0, panY: Number(v.panY) || 0, scale };
    } catch {
      return { panX: 0, panY: 0, scale: 1 };
    }
  }

  private readonly initialView = CanvasBoardComponent.loadView();
  readonly panning = signal(false);
  readonly panX = signal(this.initialView.panX);
  readonly panY = signal(this.initialView.panY);
  readonly scale = signal(this.initialView.scale);
  readonly boardW = signal(0);
  readonly boardH = signal(0);
  readonly selected = signal<Set<string>>(new Set());
  readonly selRect = signal<{ x: number; y: number; w: number; h: number } | null>(null);
  readonly selecting = signal(false);
  readonly snapLines = signal<ISnapLine[]>([]);

  readonly remoteCursors = computed(() => Array.from(this.realtime.cursors().values()));

  private panStartX = 0;
  private panStartY = 0;
  private panOriginX = 0;
  private panOriginY = 0;
  private didPan = false;
  private didSelect = false;
  private resizeObs?: ResizeObserver;
  private lastCursorSent = 0;

  readonly containers = computed(() =>
    this.list()
      .filter((c) => c.card_type === 'container')
      .sort((a, b) => a.sidebar_order - b.sidebar_order),
  );

  readonly favorites = computed(() =>
    this.list()
      .filter((c) => c.is_favorite && c.card_type !== 'container')
      .sort((a, b) => a.sidebar_order - b.sidebar_order),
  );

  readonly revealToken = signal<{ id: string; n: number } | null>(null);
  readonly copiedFavoriteId = signal<string | null>(null);
  readonly dragBookmarkId = signal<string | null>(null);
  readonly dragOverBookmarkId = signal<string | null>(null);
  private copiedFavTimeout: ReturnType<typeof setTimeout> | null = null;

  readonly hasTotps = computed(() => this.list().some((c) => c.card_type === 'totp'));
  readonly totpRemaining = signal(30);
  readonly totpCodes = signal<Record<string, string>>({});
  private totpTimer: ReturnType<typeof setInterval> | null = null;

  readonly indicators = computed<EdgeIndicator[]>(() => {
    const px = this.panX();
    const py = this.panY();
    const bw = this.boardW();
    const bh = this.boardH();
    if (!bw || !bh) return [];

    const PAD = 12;
    const result: EdgeIndicator[] = [];

    const s = this.scale();
    for (const card of this.list()) {
      const cx = card.x * s + px;
      const cy = card.y * s + py;
      const cr = cx + card.width * s;
      const cb = cy + card.height * s;

      const visH = cr > 0 && cx < bw;
      const visV = cb > 0 && cy < bh;
      if (visH && visV) continue;

      const clampX = Math.max(PAD, Math.min(bw - PAD, cx + card.width / 2));
      const clampY = Math.max(PAD, Math.min(bh - PAD, cy + card.height / 2));

      let x: number, y: number;
      let edge: EdgeIndicator['edge'] = 'corner';

      if (!visH && !visV) {
        x = cx < 0 ? PAD : bw - PAD;
        y = cy < 0 ? PAD : bh - PAD;
        edge = 'corner';
      } else if (!visV) {
        x = clampX;
        y = cy < 0 ? PAD : bh - PAD;
        edge = cy < 0 ? 'top' : 'bottom';
      } else {
        x = cx < 0 ? PAD : bw - PAD;
        y = clampY;
        edge = cx < 0 ? 'left' : 'right';
      }

      result.push({ x, y, color: this.colorsSvc.resolve(card), edge, cardId: card.id });
    }
    return result;
  });

  constructor() {
    effect(() => {
      const view = { panX: this.panX(), panY: this.panY(), scale: this.scale() };
      localStorage.setItem(CanvasBoardComponent.VIEW_STORAGE_KEY, JSON.stringify(view));
    });

    effect(async () => {
      const wsId = this.workspaces.active().id;
      await this.reloadForScope(wsId);
      this.realtime.connect(wsId);
    });

    this.realtime.onCardEvent((ev) => this.applyRemoteCardEvent(ev));
    this.realtime.onWorkspaceEvent((_kind) => {
      this.workspaces.setActive(null);
    });
  }

  async ngOnInit() {
    await this.colorsSvc.load();
    this.updateBoardSize();
    this.resizeObs = new ResizeObserver(() => this.updateBoardSize());
    this.resizeObs.observe(this.board.nativeElement);
    this.totpTimer = setInterval(() => this.tickTotp(), 1000);
  }

  ngOnDestroy() {
    this.resizeObs?.disconnect();
    if (this.totpTimer) clearInterval(this.totpTimer);
    if (this.copiedFavTimeout) clearTimeout(this.copiedFavTimeout);
    this.realtime.disconnect();
  }

  private async reloadForScope(wsId: string | null): Promise<void> {
    const list = await this.cards.list(wsId);
    this.list.set(list);
    await this.fetchAllTotp();
  }

  private applyRemoteCardEvent(ev: CardEvent): void {
    if (ev.type === 'card.created') {
      this.list.update((l) => (l.some((c) => c.id === ev.card.id) ? l : [...l, ev.card]));
    } else if (ev.type === 'card.updated') {
      this.list.update((l) => l.map((c) => (c.id === ev.card.id ? ev.card : c)));
    } else if (ev.type === 'card.deleted') {
      this.list.update((l) => l.filter((c) => c.id !== ev.id));
    }
  }

  private async fetchAllTotp() {
    if (!this.hasTotps()) return;
    try {
      const res = await this.cards.getAllTotp(this.workspaces.active().id);
      this.totpCodes.set(
        Object.fromEntries(Object.entries(res.codes).map(([id, e]) => [id, e.code])),
      );
      this.totpRemaining.set(res.remaining);
    } catch (e) {
      console.error('totp batch fetch failed', e);
    }
  }

  private tickTotp() {
    const r = this.totpRemaining();
    if (r <= 1) {
      this.fetchAllTotp();
    } else {
      this.totpRemaining.set(r - 1);
    }
  }

  totpProgressPct(): number {
    return Math.round((this.totpRemaining() / 30) * 100);
  }

  readonly totpColor = computed(() => {
    const r = Math.max(0, Math.min(30, this.totpRemaining()));
    let hue: number;
    if (r <= 5) hue = (r / 5) * 15;
    else if (r <= 10) hue = 15 + ((r - 5) / 5) * 25;
    else hue = 40 + ((r - 10) / 20) * 80;
    return `hsl(${hue}, 75%, 45%)`;
  });

  private updateBoardSize() {
    const el = this.board.nativeElement;
    this.boardW.set(el.clientWidth);
    this.boardH.set(el.clientHeight);
  }

  onBoardPointerDown(ev: PointerEvent) {
    if ((ev.target as HTMLElement).closest('app-card')) return;

    if (ev.button === 1) {
      ev.preventDefault();
      this.panning.set(true);
      this.didPan = false;
      this.panStartX = ev.clientX;
      this.panStartY = ev.clientY;
      this.panOriginX = this.panX();
      this.panOriginY = this.panY();

      const onMove = (e: PointerEvent) => {
        const dx = e.clientX - this.panStartX;
        const dy = e.clientY - this.panStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.didPan = true;
        this.panX.set(this.panOriginX + dx);
        this.panY.set(this.panOriginY + dy);
      };

      const onUp = () => {
        this.panning.set(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    } else if (ev.button === 0) {
      ev.preventDefault();
      const start = this.screenToCanvas(ev.clientX, ev.clientY);
      this.selecting.set(true);

      const onMove = (e: PointerEvent) => {
        const cur = this.screenToCanvas(e.clientX, e.clientY);
        this.selRect.set({
          x: Math.min(start.x, cur.x),
          y: Math.min(start.y, cur.y),
          w: Math.abs(cur.x - start.x),
          h: Math.abs(cur.y - start.y),
        });
      };

      const onUp = () => {
        const r = this.selRect();
        if (r && r.w > 5 && r.h > 5) {
          const sel = new Set<string>();
          for (const c of this.list()) {
            if (
              c.x >= r.x && c.x + c.width <= r.x + r.w &&
              c.y >= r.y && c.y + c.height <= r.y + r.h
            ) {
              sel.add(c.id);
            }
          }
          this.selected.set(sel);
          this.didSelect = sel.size > 0;
        }
        this.selRect.set(null);
        this.selecting.set(false);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp, { once: true });
    }
  }

  onBoardPointerMove(ev: PointerEvent): void {
    if (this.workspaces.active().id === null) return;
    const now = performance.now();
    if (now - this.lastCursorSent < 50) return;
    this.lastCursorSent = now;
    const rect = this.board.nativeElement.getBoundingClientRect();
    const canvasX = (ev.clientX - rect.left - this.panX()) / this.scale();
    const canvasY = (ev.clientY - rect.top - this.panY()) / this.scale();
    this.realtime.sendCursor(canvasX, canvasY);
  }

  onWheel(ev: WheelEvent) {
    ev.preventDefault();
    const rect = this.board.nativeElement.getBoundingClientRect();
    const mouseX = ev.clientX - rect.left;
    const mouseY = ev.clientY - rect.top;

    const oldScale = this.scale();
    const delta = ev.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(
      CanvasBoardComponent.MIN_SCALE,
      Math.min(CanvasBoardComponent.MAX_SCALE, oldScale * delta),
    );

    // Adjust pan so the point under the cursor stays fixed
    const ratio = newScale / oldScale;
    this.panX.set(mouseX - ratio * (mouseX - this.panX()));
    this.panY.set(mouseY - ratio * (mouseY - this.panY()));
    this.scale.set(newScale);
  }

  screenToCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.board.nativeElement.getBoundingClientRect();
    const s = this.scale();
    return {
      x: (clientX - rect.left - this.panX()) / s,
      y: (clientY - rect.top - this.panY()) / s,
    };
  }

  onBackgroundContextMenu(ev: MouseEvent) {
    ev.preventDefault();
    const pos = this.screenToCanvas(ev.clientX, ev.clientY);
    this.menuStep.set('type');
    this.totpFormName = '';
    this.totpFormSecret = '';
    this.passwordFormName = '';
    this.passwordFormValue = '';
    this.menu.set({
      kind: 'empty',
      x: ev.clientX,
      y: ev.clientY,
      canvasX: pos.x,
      canvasY: pos.y,
    });
  }

  onCardContextRequested(e: { card: ICard; x: number; y: number }) {
    this.menu.set({ kind: 'card', x: e.x, y: e.y, card: e.card });
  }

  closeMenu() {
    this.menu.set(null);
  }

  onBoardClick(ev: MouseEvent) {
    this.closeMenu();
    if (this.didSelect) {
      this.didSelect = false;
    } else if (!(ev.target as HTMLElement).closest('app-card')) {
      this.selected.set(new Set());
    }
  }

  onCardClick(ev: MouseEvent, card: ICard) {
    if (ev.ctrlKey || ev.metaKey) {
      const sel = new Set(this.selected());
      if (sel.has(card.id)) {
        sel.delete(card.id);
      } else {
        sel.add(card.id);
      }
      this.selected.set(sel);
      return;
    }
    this.bringToFront(card);
  }

  onCardDragStart(cardId: string) {
    if (!this.selected().has(cardId)) {
      this.selected.set(new Set());
    }

    const card = this.list().find((c) => c.id === cardId);
    if (!card) return;
    const sel = this.selected();
    const siblings = this.list().filter((c) =>
      c.id !== cardId &&
      !sel.has(c.id) &&
      (c.container_id ?? null) === (card.container_id ?? null),
    );
    this.snapCtx.activate(
      siblings.map((c) => ({ x: c.x, y: c.y, width: c.width, height: c.height })),
      (lines) => this.snapLines.set(lines),
    );
  }

  async createSecretNoteAt() {
    return this.createNoteAt(true);
  }

  async createNoteAt(isSecret = false) {
    const m = this.menu();
    if (!m || m.kind !== 'empty') return;
    const created = await this.cards.create({
      workspace_id: this.workspaces.active().id,
      x: Math.round(m.canvasX), y: Math.round(m.canvasY),
      ...(isSecret ? { is_secret: true } : {}),
    });
    this.list.update((xs) => [...xs, created]);
    this.closeMenu();
  }

  async createImageAt() {
    const m = this.menu();
    if (!m || m.kind !== 'empty') return;
    const created = await this.cards.create({ workspace_id: this.workspaces.active().id, x: Math.round(m.canvasX), y: Math.round(m.canvasY), card_type: 'image' });
    this.list.update((xs) => [...xs, created]);
    this.closeMenu();
    setTimeout(() => {
      this.menu.set({ kind: 'card', x: m.x, y: m.y, card: created });
      this.triggerUpload();
    });
  }

  async createPasswordAt() {
    const m = this.menu();
    if (!m || m.kind !== 'empty') return;
    if (!this.passwordFormName.trim() || !this.passwordFormValue) return;
    const created = await this.cards.create({
      workspace_id: this.workspaces.active().id,
      x: Math.round(m.canvasX),
      y: Math.round(m.canvasY),
      card_type: 'password',
      title: this.passwordFormName.trim(),
      text: this.passwordFormValue,
    });
    this.list.update((xs) => [...xs, created]);
    this.closeMenu();
  }

  async createTotpAt() {
    const m = this.menu();
    if (!m || m.kind !== 'empty') return;
    if (!this.totpFormName.trim() || !this.totpFormSecret.trim()) return;
    const created = await this.cards.createTotp({
      workspace_id: this.workspaces.active().id,
      x: Math.round(m.canvasX),
      y: Math.round(m.canvasY),
      totp_name: this.totpFormName.trim(),
      totp_secret: this.totpFormSecret.trim(),
    });
    this.list.update((xs) => [...xs, created]);
    this.closeMenu();
    this.fetchAllTotp();
  }

  async createContainerAt(color: string) {
    const m = this.menu();
    if (!m || m.kind !== 'empty') return;
    const created = await this.cards.create({
      workspace_id: this.workspaces.active().id,
      x: Math.round(m.canvasX),
      y: Math.round(m.canvasY),
      width: 400,
      height: 300,
      color,
      card_type: 'container',
    });
    this.list.update((xs) => [...xs, created]);
    this.closeMenu();
  }

  async changeCardColor(color: string) {
    const m = this.menu();
    if (!m || m.kind !== 'card') return;
    const updated = await this.cards.patch(m.card.id, { color });
    this.list.update((xs) => xs.map((c) => (c.id === updated.id ? updated : c)));
    this.closeMenu();
  }

  async bringToFront(card: ICard) {
    const maxZ = this.list().reduce((m, c) => Math.max(m, c.z_index), 0);
    if (card.z_index === maxZ) return;
    this.list.update((xs) => xs.map((c) => (c.id === card.id ? { ...c, z_index: maxZ + 1 } : c)));
    await this.cards.patch(card.id, { z_index: maxZ + 1 });
  }

  async autoOrganizeContainer() {
    const m = this.menu();
    if (!m || m.kind !== 'card' || m.card.card_type !== 'container') return;
    const container = m.card;
    const children = this.list().filter((c) => c.container_id === container.id);
    if (children.length === 0) {
      this.closeMenu();
      return;
    }

    const PAD = 24;
    const GAP = 16;
    const HEADER = 48;
    const cols = Math.ceil(Math.sqrt(children.length));
    const rows = Math.ceil(children.length / cols);
    const cardW = Math.max(...children.map((c) => c.width));
    const cardH = Math.max(...children.map((c) => c.height));
    const newWidth = 2 * PAD + cols * cardW + (cols - 1) * GAP;
    const newHeight = HEADER + 2 * PAD + rows * cardH + (rows - 1) * GAP;

    const typeOrder = (c: ICard): number => {
      if (c.card_type === 'note') return c.is_secret ? 1 : 0;
      if (c.card_type === 'image') return 2;
      if (c.card_type === 'totp') return 3;
      return 4;
    };
    const sorted = [...children].sort(
      (a, b) => typeOrder(a) - typeOrder(b) || a.y - b.y || a.x - b.x,
    );
    const updates = new Map<string, ICard>();
    const patches: Promise<ICard>[] = [];

    sorted.forEach((c, i) => {
      const r = Math.floor(i / cols);
      const col = i % cols;
      const x = container.x + PAD + col * (cardW + GAP);
      const y = container.y + HEADER + PAD + r * (cardH + GAP);
      updates.set(c.id, { ...c, x, y, width: cardW, height: cardH });
      patches.push(this.cards.patch(c.id, { x, y, width: cardW, height: cardH }));
    });

    updates.set(container.id, { ...container, width: newWidth, height: newHeight });
    patches.push(this.cards.patch(container.id, { width: newWidth, height: newHeight }));

    this.list.update((xs) => xs.map((c) => updates.get(c.id) ?? c));
    this.closeMenu();

    try {
      const results = await Promise.all(patches);
      const mResults = new Map(results.map((r) => [r.id, r]));
      this.list.update((xs) => xs.map((c) => mResults.get(c.id) ?? c));
    } catch (e) {
      console.error('auto-organize failed', e);
    }
  }

  async deleteCard() {
    const m = this.menu();
    if (!m || m.kind !== 'card') return;
    await this.cards.delete(m.card.id);
    this.list.update((xs) => xs.filter((c) => c.id !== m.card.id));
    this.closeMenu();
  }

  triggerUpload() {
    this.fi?.nativeElement.click();
  }

  async uploadImage(ev: Event) {
    const m = this.menu();
    if (!m || m.kind !== 'card') return;
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be 5MB or less');
      return;
    }
    await this.cards.uploadImage(m.card.id, file);
    this.list.set(await this.cards.list(this.workspaces.active().id));
    this.closeMenu();
  }

  async removeImage() {
    const m = this.menu();
    if (!m || m.kind !== 'card') return;
    await this.cards.removeImage(m.card.id);
    this.list.set(await this.cards.list(this.workspaces.active().id));
    this.closeMenu();
  }

  openColorPicker(cb: (color: string) => void) {
    this.colorPickerCallback = cb;
    this.cp?.nativeElement.click();
  }

  onCustomColor(ev: Event) {
    const color = (ev.target as HTMLInputElement).value;
    this.colorPickerCallback?.(color);
    this.colorPickerCallback = null;
  }

  replaceLocally(card: ICard) {
    const old = this.list().find((c) => c.id === card.id);

    if (card.card_type !== 'container') {
      const centerX = card.x + card.width / 2;
      const centerY = card.y + card.height / 2;
      const containers = this.list().filter((c) => c.card_type === 'container' && c.id !== card.id);
      let hovered: string | null = null;
      for (const cont of containers) {
        if (
          centerX >= cont.x && centerX <= cont.x + cont.width &&
          centerY >= cont.y && centerY <= cont.y + cont.height
        ) {
          hovered = cont.id;
          break;
        }
      }
      this.highlightedContainerId.set(hovered);
    }

    const dx = old ? card.x - old.x : 0;
    const dy = old ? card.y - old.y : 0;
    const hasDelta = dx !== 0 || dy !== 0;
    const sel = this.selected();
    const isGroupMove = hasDelta && sel.has(card.id) && sel.size > 1;
    const isContainerMove = hasDelta && card.card_type === 'container';

    if (!isGroupMove && !isContainerMove) {
      this.list.update((xs) => xs.map((c) => (c.id === card.id ? card : c)));
      return;
    }

    this.list.update((xs) =>
      xs.map((c) => {
        if (c.id === card.id) return card;
        if (isGroupMove && sel.has(c.id)) return { ...c, x: c.x + dx, y: c.y + dy };
        if (isContainerMove && c.container_id === card.id) return { ...c, x: c.x + dx, y: c.y + dy };
        return c;
      }),
    );
  }

  async onFavoriteClick(card: ICard) {
    if (card.card_type === 'totp') {
      const code = this.totpCodes()[card.id];
      if (code) await this.copyToClipboard(code, card.id);
      return;
    }
    if (card.card_type === 'password') {
      if (card.text) await this.copyToClipboard(card.text, card.id);
      return;
    }
    if (card.card_type === 'note' && !card.is_secret) {
      if (card.text) await this.copyToClipboard(card.text, card.id);
      return;
    }
    this.navigateToCard(card, true);
    if (card.is_secret) {
      const prev = this.revealToken();
      this.revealToken.set({ id: card.id, n: (prev?.n ?? 0) + 1 });
    }
  }

  onBookmarkDragStart(ev: DragEvent, id: string) {
    this.dragBookmarkId.set(id);
    if (ev.dataTransfer) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', id);
    }
  }

  onBookmarkDragOver(ev: DragEvent, targetId: string, section: 'containers' | 'favorites') {
    const src = this.dragBookmarkId();
    if (!src || src === targetId) return;
    const list = section === 'containers' ? this.containers() : this.favorites();
    if (!list.some((c) => c.id === src)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    this.dragOverBookmarkId.set(targetId);
  }

  onBookmarkDragEnd() {
    this.dragBookmarkId.set(null);
    this.dragOverBookmarkId.set(null);
  }

  async onBookmarkDrop(ev: DragEvent, targetId: string, section: 'containers' | 'favorites') {
    ev.preventDefault();
    const src = this.dragBookmarkId();
    this.dragBookmarkId.set(null);
    this.dragOverBookmarkId.set(null);
    if (!src || src === targetId) return;

    const sectionList = section === 'containers' ? this.containers() : this.favorites();
    const srcIdx = sectionList.findIndex((c) => c.id === src);
    const tgtIdx = sectionList.findIndex((c) => c.id === targetId);
    if (srcIdx < 0 || tgtIdx < 0) return;

    const reordered = [...sectionList];
    const [moved] = reordered.splice(srcIdx, 1);
    reordered.splice(tgtIdx, 0, moved);

    const changes = reordered
      .map((c, i) => ({ id: c.id, next: i, prev: c.sidebar_order }))
      .filter((u) => u.next !== u.prev);
    if (changes.length === 0) return;

    this.list.update((xs) =>
      xs.map((c) => {
        const u = changes.find((ch) => ch.id === c.id);
        return u ? { ...c, sidebar_order: u.next } : c;
      }),
    );

    await Promise.all(changes.map((u) => this.cards.patch(u.id, { sidebar_order: u.next })));
  }

  favoriteLabel(card: ICard): string {
    if (card.card_type === 'totp') return card.totp_name || 'TOTP';
    if (card.card_type === 'password') return card.title || 'Password';
    if (card.is_secret) return card.title || 'Secret';
    if (card.card_type === 'image') return card.title || 'Image';
    const text = (card.text || '').trim();
    return text ? text.slice(0, 40) : 'Note';
  }

  favoriteDotColor(card: ICard): string {
    return this.colorsSvc.resolve(card);
  }

  private async copyToClipboard(text: string, favoriteId: string) {
    await navigator.clipboard.writeText(text);
    this.copiedFavoriteId.set(favoriteId);
    if (this.copiedFavTimeout) clearTimeout(this.copiedFavTimeout);
    this.copiedFavTimeout = setTimeout(() => this.copiedFavoriteId.set(null), 1500);
  }

  navigateToCard(card: ICard, fit = false) {
    const bw = this.boardW();
    const bh = this.boardH();
    const cx = card.x + card.width / 2;
    const cy = card.y + card.height / 2;
    let s = this.scale();
    if (fit && card.width > 0 && card.height > 0) {
      const PAD = 0.9;
      const fitScale = Math.min((bw / card.width) * PAD, (bh / card.height) * PAD);
      s = Math.min(
        CanvasBoardComponent.MAX_SCALE,
        Math.max(CanvasBoardComponent.MIN_SCALE, fitScale),
      );
      this.scale.set(s);
    }
    this.panX.set(bw / 2 - cx * s);
    this.panY.set(bh / 2 - cy * s);
  }

  navigateToIndicator(ind: EdgeIndicator) {
    const card = this.list().find((c) => c.id === ind.cardId);
    if (card) this.navigateToCard(card);
  }

  async onCardDropped(card: ICard) {
    this.highlightedContainerId.set(null);
    const sel = this.selected();

    if (sel.has(card.id) && sel.size > 1) {
      const allCards = this.list();
      const staticContainers = allCards.filter((c) => c.card_type === 'container' && !sel.has(c.id));
      const selContainerIds = new Set(
        allCards.filter((c) => sel.has(c.id) && c.card_type === 'container').map((c) => c.id),
      );

      const findContainer = (c: ICard): string | null => {
        const cx = c.x + c.width / 2;
        const cy = c.y + c.height / 2;
        for (const cont of staticContainers) {
          if (cx >= cont.x && cx <= cont.x + cont.width &&
              cy >= cont.y && cy <= cont.y + cont.height) {
            return cont.id;
          }
        }
        return null;
      };

      const patches: Promise<ICard>[] = [];

      for (const sc of allCards) {
        if (sc.id === card.id) continue;
        if (sel.has(sc.id)) {
          const body: Record<string, unknown> = { x: sc.x, y: sc.y };
          if (sc.card_type !== 'container') {
            const targetId = findContainer(sc);
            if (targetId !== (sc.container_id || null)) {
              body['container_id'] = targetId || '';
            }
          }
          patches.push(this.cards.patch(sc.id, body as any));
        } else if (sc.container_id && selContainerIds.has(sc.container_id)) {
          patches.push(this.cards.patch(sc.id, { x: sc.x, y: sc.y }));
        }
      }

      if (card.card_type !== 'container') {
        const targetId = findContainer(card);
        if (targetId !== (card.container_id || null)) {
          patches.push(this.cards.patch(card.id, { container_id: targetId || '' }));
        }
      }

      if (patches.length > 0) {
        const results = await Promise.all(patches);
        const updated = new Map(results.map((r) => [r.id, r]));
        this.list.update((xs) => xs.map((c) => updated.get(c.id) ?? c));
      }
      this.selected.set(new Set());
      return;
    }

    if (card.card_type === 'container') {
      const children = this.list().filter((c) => c.container_id === card.id);
      if (children.length > 0) {
        await Promise.all(children.map((c) => this.cards.patch(c.id, { x: c.x, y: c.y })));
      }
      return;
    }

    const centerX = card.x + card.width / 2;
    const centerY = card.y + card.height / 2;
    const containers = this.list().filter((c) => c.card_type === 'container');

    let targetId: string | null = null;
    for (const cont of containers) {
      if (
        centerX >= cont.x && centerX <= cont.x + cont.width &&
        centerY >= cont.y && centerY <= cont.y + cont.height
      ) {
        targetId = cont.id;
        break;
      }
    }

    const currentId = card.container_id || null;
    if (targetId !== currentId) {
      const updated = await this.cards.patch(card.id, { container_id: targetId || '' });
      this.list.update((xs) => xs.map((c) => (c.id === updated.id ? updated : c)));
    }
  }
}
