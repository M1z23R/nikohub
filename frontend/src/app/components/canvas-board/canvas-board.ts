import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { CardComponent } from '../card/card';
import { Card, CardService } from '../../core/api/card.service';

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

  async ngOnInit() {
    this.list.set(await this.cards.list());
  }

  onBackgroundContextMenu(ev: MouseEvent) {
    ev.preventDefault();
    const rect = this.board.nativeElement.getBoundingClientRect();
    const scrollLeft = this.board.nativeElement.scrollLeft;
    const scrollTop = this.board.nativeElement.scrollTop;
    this.menu.set({
      kind: 'empty',
      x: ev.clientX,
      y: ev.clientY,
      canvasX: ev.clientX - rect.left + scrollLeft,
      canvasY: ev.clientY - rect.top + scrollTop,
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
