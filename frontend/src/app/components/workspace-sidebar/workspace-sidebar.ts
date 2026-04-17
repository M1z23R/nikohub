import { Component, inject, signal } from '@angular/core';
import { WorkspaceService, IWorkspace } from '../../core/workspace/workspace.service';
import { WorkspaceDialog } from '../workspace-dialog/workspace-dialog';
import { WorkspaceSettings } from '../workspace-settings/workspace-settings';

@Component({
  selector: 'app-workspace-sidebar',
  standalone: true,
  imports: [WorkspaceDialog, WorkspaceSettings],
  templateUrl: './workspace-sidebar.html',
  styleUrl: './workspace-sidebar.css',
})
export class WorkspaceSidebar {
  private svc = inject(WorkspaceService);

  readonly list = this.svc.list;
  readonly activeId = this.svc.activeId;
  readonly dialogOpen = signal(false);
  readonly menuFor = signal<IWorkspace | null>(null);
  readonly settingsFor = signal<IWorkspace | null>(null);

  select(w: IWorkspace): void {
    this.svc.setActive(w.id);
  }

  openDialog(): void {
    this.dialogOpen.set(true);
  }

  toggleMenu(w: IWorkspace, ev: MouseEvent): void {
    ev.stopPropagation();
    this.menuFor.update((m) => (m?.id === w.id ? null : w));
  }

  async leave(w: IWorkspace): Promise<void> {
    if (!w.id) return;
    this.menuFor.set(null);
    await this.svc.leave(w.id);
  }

  openSettings(w: IWorkspace): void {
    this.menuFor.set(null);
    this.settingsFor.set(w);
  }
}
