import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { ButtonComponent, InputComponent } from '@m1z23r/ngx-ui';
import { CardComponent } from '../card/card';
import { ICard, CardService } from '../../core/api/card.service';

export interface EdgeIndicator {
  x: number;
  y: number;
  color: string;
  edge: 'top' | 'bottom' | 'left' | 'right' | 'corner';
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

  private static readonly MIN_SCALE = 0.1;
  private static readonly MAX_SCALE = 3;
  private panStartX = 0;
  private panStartY = 0;
  private panOriginX = 0;
  private panOriginY = 0;
  private didPan = false;
  private resizeObs?: ResizeObserver;

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

      result.push({ x, y, color: card.color, edge });
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
    if (ev.button !== 0 && ev.button !== 1) return;
    if (ev.button === 0 && (ev.target as HTMLElement).closest('app-card')) return;

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
    const updated = await this.cards.patch(card.id, { z_index: maxZ + 1 });
    this.list.update((xs) => xs.map((c) => (c.id === updated.id ? updated : c)));
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

    if (old && card.card_type === 'container') {
      const dx = card.x - old.x;
      const dy = card.y - old.y;
      if (dx !== 0 || dy !== 0) {
        this.list.update((xs) =>
          xs.map((c) => {
            if (c.id === card.id) return card;
            if (c.container_id === card.id) return { ...c, x: c.x + dx, y: c.y + dy };
            return c;
          }),
        );
        return;
      }
    }

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

    this.list.update((xs) => xs.map((c) => (c.id === card.id ? card : c)));
  }

  async onCardDropped(card: ICard) {
    this.highlightedContainerId.set(null);

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
