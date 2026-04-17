import { Component, inject, input, output, signal } from '@angular/core';
import {
  WorkspaceService,
  IWorkspace,
  IWorkspaceMember,
} from '../../core/workspace/workspace.service';

type Pane = 'rename' | 'codes' | 'members' | 'delete';

@Component({
  selector: 'app-workspace-settings',
  standalone: true,
  templateUrl: './workspace-settings.html',
  styleUrl: './workspace-settings.css',
})
export class WorkspaceSettings {
  private svc = inject(WorkspaceService);

  readonly workspace = input.required<IWorkspace>();
  readonly closed = output<void>();

  readonly pane = signal<Pane>('rename');
  readonly renameValue = signal('');
  readonly members = signal<IWorkspaceMember[] | null>(null);
  readonly confirmName = signal('');
  readonly busy = signal(false);
  readonly error = signal('');

  open(p: Pane): void {
    this.pane.set(p);
    this.error.set('');
    if (p === 'rename') this.renameValue.set(this.workspace().name);
    if (p === 'members') this.loadMembers();
    if (p === 'delete') this.confirmName.set('');
  }

  async rename(): Promise<void> {
    const n = this.renameValue().trim();
    const id = this.workspace().id;
    if (!n || !id || this.busy()) return;
    this.busy.set(true);
    try {
      await this.svc.rename(id, n);
      this.closed.emit();
    } finally {
      this.busy.set(false);
    }
  }

  async rotate(kind: 'viewer' | 'editor'): Promise<void> {
    const id = this.workspace().id;
    if (!id) return;
    await this.svc.rotateCode(id, kind);
  }

  async disable(kind: 'viewer' | 'editor'): Promise<void> {
    const id = this.workspace().id;
    if (!id) return;
    await this.svc.disableCode(id, kind);
  }

  async copy(code: string): Promise<void> {
    await navigator.clipboard.writeText(code);
  }

  async loadMembers(): Promise<void> {
    const id = this.workspace().id;
    if (!id) return;
    this.members.set(null);
    const m = await this.svc.members(id);
    this.members.set(m);
  }

  async kick(userId: string): Promise<void> {
    const id = this.workspace().id;
    if (!id) return;
    await this.svc.kick(id, userId);
    this.members.update((m) => (m ?? []).filter((x) => x.user_id !== userId));
  }

  async remove(): Promise<void> {
    const id = this.workspace().id;
    if (!id) return;
    if (this.confirmName() !== this.workspace().name) {
      this.error.set('Name mismatch');
      return;
    }
    this.busy.set(true);
    try {
      await this.svc.delete(id);
      this.closed.emit();
    } finally {
      this.busy.set(false);
    }
  }
}
