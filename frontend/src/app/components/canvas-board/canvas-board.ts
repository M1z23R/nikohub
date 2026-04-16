import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { CardComponent } from '../card/card';
import { Card, CardService } from '../../core/api/card.service';

export interface EdgeIndicator {
  x: number;
  y: number;
  color: string;
  edge: 'top' | 'bottom' | 'left' | 'right' | 'corner';
}

const COLORS = ['#fde68a', '#fbcfe8', '#bfdbfe', '#bbf7d0', '#ddd6fe', '#fed7aa'];

type Menu =
  | { kind: 'empty'; x: number; y: number; canvasX: number; canvasY: number }
  | { kind: 'card'; x: number; y: number; card: Card }
  | null;

@Component({
  selector: 'app-canvas-board',
  standalone: true,
  imports: [CardComponent],
  templateUrl: './canvas-board.html',
  styleUrl: './canvas-board.css',
})
export class CanvasBoardComponent {
  private cards = inject(CardService);
  readonly colors = COLORS;
  readonly list = signal<Card[]>([]);
  readonly menu = signal<Menu>(null);

  @ViewChild('board', { static: true }) board!: ElementRef<HTMLDivElement>;
  @ViewChild('fi') fi?: ElementRef<HTMLInputElement>;

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
    this.menu.set({
      kind: 'empty',
      x: ev.clientX,
      y: ev.clientY,
      canvasX: pos.x,
      canvasY: pos.y,
    });
  }

  onCardContextRequested(e: { card: Card; x: number; y: number }) {
    this.menu.set({ kind: 'card', x: e.x, y: e.y, card: e.card });
  }

  closeMenu() {
    this.menu.set(null);
  }

  async createAt(color: string) {
    const m = this.menu();
    if (!m || m.kind !== 'empty') return;
    const created = await this.cards.create({ x: Math.round(m.canvasX), y: Math.round(m.canvasY), color });
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

  async bringToFront(card: Card) {
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

  replaceLocally(card: Card) {
    this.list.update((xs) => xs.map((c) => (c.id === card.id ? card : c)));
  }
}
