import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { ICard, CardService, CardPatch } from '../../core/api/card.service';
import { CardTypeColorsService } from '../../core/api/card-type-colors.service';
import { WorkspaceService } from '../../core/workspace/workspace.service';
import { SnapContext } from '../../core/snap';

type DragMode = 'move' | 'resize' | null;

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [],
  templateUrl: './card.html',
  styleUrl: './card.css',
})
export class CardComponent implements OnInit, OnDestroy {
  private cards = inject(CardService);
  private snapCtx = inject(SnapContext);
  private colorsSvc = inject(CardTypeColorsService);
  private workspaces = inject(WorkspaceService);

  readonly cardIn = input.required<ICard>({ alias: 'card' });
  readonly highlighted = input(false);
  readonly isSelected = input(false);
  readonly scale = input(1);
  readonly totpCode = input('');
  readonly revealToken = input<{ id: string; n: number } | null>(null);

  readonly changed = output<ICard>();
  readonly deleted = output<string>();
  readonly dropped = output<ICard>();
  readonly moveStarted = output<string>();
  readonly contextRequested = output<{ card: ICard; x: number; y: number }>();

  private readonly localCard = signal<ICard | null>(null);
  readonly card = computed<ICard>(() => this.localCard() ?? this.cardIn());

  readonly editing = signal(false);
  readonly editingTitle = signal(false);
  readonly revealed = signal(false);
  readonly copied = signal(false);

  readonly isViewer = computed(() => this.workspaces.active().role === 'viewer');

  readonly displayText = computed<string>(() => {
    const c = this.card();
    if (!this.isViewer()) return c.text;
    if (c.card_type === 'password' || (c.card_type === 'note' && c.is_secret)) {
      return '••• hidden •••';
    }
    return c.text;
  });

  readonly isHidden = computed<boolean>(() => {
    const c = this.card();
    return c.card_type === 'totp' || c.card_type === 'password' || c.is_secret;
  });

  readonly cardBackground = computed<string>(() => {
    const c = this.card();
    if (c.card_type === 'container') {
      return `color-mix(in srgb, ${c.color} 20%, transparent)`;
    }
    return this.colorsSvc.resolve(c);
  });

  @ViewChild('ta') ta?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('titleInput') titleInput?: ElementRef<HTMLInputElement>;

  private copiedTimeout: ReturnType<typeof setTimeout> | null = null;

  private mode: DragMode = null;
  private startX = 0;
  private startY = 0;
  private origX = 0;
  private origY = 0;
  private origW = 0;
  private origH = 0;

  constructor() {
    effect(() => {
      const tok = this.revealToken();
      if (tok && tok.id === this.cardIn().id) this.revealed.set(true);
    });
  }

  ngOnInit() {
    const c = this.cardIn();
    if (c.is_secret && !c.text) {
      this.revealed.set(true);
    }
  }

  ngOnDestroy() {
    if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
  }

  private setCard(next: ICard): void {
    this.localCard.set(next);
  }

  toggleReveal() {
    this.revealed.set(!this.revealed());
  }

  async toggleFavorite() {
    const next = !this.card().is_favorite;
    const updated = { ...this.card(), is_favorite: next };
    this.setCard(updated);
    this.changed.emit(updated);
    await this.persist({ is_favorite: next } as CardPatch);
  }

  async copyText() {
    const c = this.card();
    const text = c.card_type === 'totp' ? this.totpCode() : c.text;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    this.copied.set(true);
    if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
    this.copiedTimeout = setTimeout(() => this.copied.set(false), 1500);
  }

  maskedText(): string {
    return this.card().text.replace(/./g, '\u2022');
  }

  maskedTotp(): string {
    return '\u2022\u2022\u2022 \u2022\u2022\u2022';
  }

  formattedTotp(): string {
    const code = this.totpCode();
    if (code.length === 6) return code.slice(0, 3) + ' ' + code.slice(3);
    return code;
  }

  onHeaderPointerDown(ev: PointerEvent) {
    if (this.isViewer()) return;
    if (this.editing()) return;
    if (ev.ctrlKey || ev.metaKey) return;
    this.moveStarted.emit(this.card().id);
    this.mode = 'move';
    this.startDrag(ev);
  }

  onResizePointerDown(ev: PointerEvent) {
    if (this.isViewer()) return;
    this.moveStarted.emit(this.card().id);
    this.mode = 'resize';
    this.startDrag(ev);
    ev.stopPropagation();
  }

  private startDrag(ev: PointerEvent) {
    ev.preventDefault();
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    const c = this.card();
    this.startX = ev.clientX;
    this.startY = ev.clientY;
    this.origX = c.x;
    this.origY = c.y;
    this.origW = c.width;
    this.origH = c.height;
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp, { once: true });
  }

  private onMove = (ev: PointerEvent) => {
    const scale = this.scale();
    const dx = (ev.clientX - this.startX) / scale;
    const dy = (ev.clientY - this.startY) / scale;
    const c = this.card();
    if (this.mode === 'move') {
      let x = this.origX + dx;
      let y = this.origY + dy;
      const snap = this.snapCtx.snapMove({ x, y, width: c.width, height: c.height });
      if (snap) { x = snap.x; y = snap.y; }
      const updated = { ...c, x, y };
      this.setCard(updated);
      this.changed.emit(updated);
    } else if (this.mode === 'resize') {
      let width = Math.max(120, this.origW + dx);
      let height = Math.max(90, this.origH + dy);
      const snap = this.snapCtx.snapResize({ x: c.x, y: c.y, width, height });
      if (snap) {
        width = Math.max(120, snap.width);
        height = Math.max(90, snap.height);
      }
      const updated = { ...c, width, height };
      this.setCard(updated);
      this.changed.emit(updated);
    }
  };

  private onUp = async () => {
    window.removeEventListener('pointermove', this.onMove);
    this.snapCtx.deactivate();
    const mode = this.mode;
    this.mode = null;
    const c = this.card();
    if (mode === 'move') {
      await this.persist({ x: c.x, y: c.y });
      this.dropped.emit(c);
    } else if (mode === 'resize') {
      await this.persist({ width: c.width, height: c.height });
    }
  };

  private async persist(body: CardPatch) {
    try {
      const updated = await this.cards.patch(this.card().id, body);
      this.localCard.set(null);
      this.changed.emit(updated);
    } catch (e) {
      console.error('patch failed', e);
    }
  }

  onContextMenu(ev: MouseEvent) {
    ev.preventDefault();
    ev.stopPropagation();
    if (this.isViewer()) return;
    this.contextRequested.emit({ card: this.card(), x: ev.clientX, y: ev.clientY });
  }

  onTextDblClick(ev: MouseEvent) {
    if (this.isViewer()) return;
    if (this.card().is_secret && !this.revealed()) return;
    ev.stopPropagation();
    this.editing.set(true);
    requestAnimationFrame(() => this.ta?.nativeElement.focus());
  }

  async commitEdit() {
    const value = this.ta?.nativeElement.value ?? this.card().text;
    this.editing.set(false);
    if (value === this.card().text) return;
    this.setCard({ ...this.card(), text: value });
    await this.persist({ text: value });
  }

  onTitleDblClick(ev: MouseEvent) {
    if (this.isViewer()) return;
    ev.stopPropagation();
    this.editingTitle.set(true);
    requestAnimationFrame(() => this.titleInput?.nativeElement.focus());
  }

  async commitTitleEdit() {
    const value = this.titleInput?.nativeElement.value ?? this.card().title;
    this.editingTitle.set(false);
    if (value === this.card().title) return;
    this.setCard({ ...this.card(), title: value });
    await this.persist({ title: value });
  }

  imageUrl(): string {
    return this.cards.imageUrl(this.card().id, this.card().updated_at);
  }
}
