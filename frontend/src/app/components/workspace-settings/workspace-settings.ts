import { Component, computed, effect, inject, signal } from '@angular/core';
import {
  AlertComponent,
  BadgeComponent,
  ButtonComponent,
  DIALOG_DATA,
  DIALOG_REF,
  DialogRef,
  InputComponent,
  ModalComponent,
  TabComponent,
  TabsComponent,
} from '@m1z23r/ngx-ui';
import {
  IWorkspace,
  IWorkspaceMember,
  WorkspaceService,
} from '../../core/workspace/workspace.service';

interface IWorkspaceSettingsData {
  workspaceId: string;
}

@Component({
  selector: 'app-workspace-settings',
  standalone: true,
  imports: [
    ModalComponent,
    ButtonComponent,
    InputComponent,
    TabsComponent,
    TabComponent,
    BadgeComponent,
    AlertComponent,
  ],
  templateUrl: './workspace-settings.html',
  styleUrl: './workspace-settings.css',
})
export class WorkspaceSettings {
  private dialogRef = inject(DIALOG_REF) as DialogRef<void>;
  private data = inject(DIALOG_DATA) as IWorkspaceSettingsData;
  private svc = inject(WorkspaceService);

  readonly workspace = computed<IWorkspace | undefined>(() =>
    this.svc.list().find((w) => w.id === this.data.workspaceId),
  );

  readonly activeTab = signal<string | number>('rename');
  readonly renameValue = signal('');
  readonly members = signal<IWorkspaceMember[] | null>(null);
  readonly confirmName = signal('');
  readonly busy = signal(false);
  readonly error = signal('');

  constructor() {
    const w = this.workspace();
    if (w) this.renameValue.set(w.name);

    effect(() => {
      const tab = this.activeTab();
      this.error.set('');
      const current = this.workspace();
      if (!current) return;
      if (tab === 'rename') this.renameValue.set(current.name);
      if (tab === 'members') void this.loadMembers();
      if (tab === 'delete') this.confirmName.set('');
    });
  }

  async rename(): Promise<void> {
    const w = this.workspace();
    const n = this.renameValue().trim();
    if (!n || !w?.id || this.busy()) return;
    this.busy.set(true);
    try {
      await this.svc.rename(w.id, n);
      this.dialogRef.close();
    } finally {
      this.busy.set(false);
    }
  }

  async rotate(kind: 'viewer' | 'editor'): Promise<void> {
    const w = this.workspace();
    if (!w?.id) return;
    await this.svc.rotateCode(w.id, kind);
  }

  async disable(kind: 'viewer' | 'editor'): Promise<void> {
    const w = this.workspace();
    if (!w?.id) return;
    await this.svc.disableCode(w.id, kind);
  }

  async copy(code: string): Promise<void> {
    await navigator.clipboard.writeText(code);
  }

  async loadMembers(): Promise<void> {
    const w = this.workspace();
    if (!w?.id) return;
    this.members.set(null);
    const m = await this.svc.members(w.id);
    this.members.set(m);
  }

  async kick(userId: string): Promise<void> {
    const w = this.workspace();
    if (!w?.id) return;
    await this.svc.kick(w.id, userId);
    this.members.update((m) => (m ?? []).filter((x) => x.user_id !== userId));
  }

  async remove(): Promise<void> {
    const w = this.workspace();
    if (!w?.id) return;
    if (this.confirmName() !== w.name) {
      this.error.set('Name mismatch');
      return;
    }
    this.busy.set(true);
    try {
      await this.svc.delete(w.id);
      this.dialogRef.close();
    } finally {
      this.busy.set(false);
    }
  }

  dismiss(): void {
    this.dialogRef.close();
  }
}
