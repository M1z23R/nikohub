import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { ButtonComponent, InputComponent } from '@m1z23r/ngx-ui';
import { CardComponent } from '../card/card';
import { ICard, CardService } from '../../core/api/card.service';
import { SnapContext, ISnapLine } from '../../core/snap';

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
  imports: [CardComponent, ButtonComponent, InputComponent],
  templateUrl: './canvas-board.html',
  styleUrl: './canvas-board.css',
})
export class CanvasBoardComponent {
  private cards = inject(CardService);
  private snapCtx = inject(SnapContext);
  readonly colors = COLORS;
  readonly list = signal<ICard[]>([]);
  readonly menu = signal<Menu>(null);
  readonly menuStep = signal<'type' | 'note-color' | 'secret-color' | 'image-color' | 'totp-form' | 'container-color'>('type');
  readonly highlightedContainerId = signal<string | null>(null);
  totpFormName = '';
  totpFormSecret = '';

  @ViewChild('board', { static: true }) board!: ElementRef<HTMLDivElement>;
  @ViewChild('fi') fi?: ElementRef<HTMLInputElement>;
  @ViewChild('cp') cp?: ElementRef<HTMLInputElement>;
  private colorPickerCallback: ((color: string) => void) | null = null;

  readonly panning = signal(false);
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly scale = signal(1);
  readonly boardW = signal(0);
  readonly boardH = signal(0);
  readonly selected = signal<Set<string>>(new Set());
  readonly selRect = signal<{ x: number; y: number; w: number; h: number } | null>(null);
  readonly selecting = signal(false);
  readonly snapLines = signal<ISnapLine[]>([]);

  private static readonly MIN_SCALE = 0.1;
  private static readonly MAX_SCALE = 3;
  private panStartX = 0;
  private panStartY = 0;
  private panOriginX = 0;
  private panOriginY = 0;
  private didPan = false;
  private didSelect = false;
  private resizeObs?: ResizeObserver;

  readonly containers = computed(() =>
    this.list().filter((c) => c.card_type === 'container'),
  );

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

      result.push({ x, y, color: card.color, edge, cardId: card.id });
    }
    return result;
  });

  async ngOnInit() {
    this.list.set(await this.cards.list());
    this.updateBoardSize();
    this.resizeObs = new ResizeObserver(() => this.updateBoardSize());
    this.resizeObs.observe(this.board.nativeElement);
  }

  ngOnDestroy() {
    this.resizeObs?.disconnect();
  }

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

  async createSecretNoteAt(color: string) {
    return this.createNoteAt(color, true);
  }

  async createNoteAt(color: string, isSecret = false) {
    const m = this.menu();
    if (!m || m.kind !== 'empty') return;
    const created = await this.cards.create({
      x: Math.round(m.canvasX), y: Math.round(m.canvasY), color,
      ...(isSecret ? { is_secret: true } : {}),
    });
    this.list.update((xs) => [...xs, created]);
    this.closeMenu();
  }

  async createImageAt(color: string) {
    const m = this.menu();
    if (!m || m.kind !== 'empty') return;
    const created = await this.cards.create({ x: Math.round(m.canvasX), y: Math.round(m.canvasY), color, card_type: 'image' });
    this.list.update((xs) => [...xs, created]);
    this.closeMenu();
    setTimeout(() => {
      this.menu.set({ kind: 'card', x: m.x, y: m.y, card: created });
      this.triggerUpload();
    });
  }

  async createTotpAt() {
    const m = this.menu();
    if (!m || m.kind !== 'empty') return;
    if (!this.totpFormName.trim() || !this.totpFormSecret.trim()) return;
    const created = await this.cards.createTotp({
      x: Math.round(m.canvasX),
      y: Math.round(m.canvasY),
      totp_name: this.totpFormName.trim(),
      totp_secret: this.totpFormSecret.trim(),
    });
    this.list.update((xs) => [...xs, created]);
    this.closeMenu();
  }

  async createContainerAt(color: string) {
    const m = this.menu();
    if (!m || m.kind !== 'empty') return;
    const created = await this.cards.create({
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
    this.list.set(await this.cards.list());
    this.closeMenu();
  }

  async removeImage() {
    const m = this.menu();
    if (!m || m.kind !== 'card') return;
    await this.cards.removeImage(m.card.id);
    this.list.set(await this.cards.list());
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

  navigateToCard(card: ICard) {
    const bw = this.boardW();
    const bh = this.boardH();
    const cx = card.x + card.width / 2;
    const cy = card.y + card.height / 2;
    const s = this.scale();
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
