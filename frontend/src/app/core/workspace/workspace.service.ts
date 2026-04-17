import { Injectable, computed, signal } from '@angular/core';
import { http } from '../api/http';

export type WorkspaceRole = 'owner' | 'editor' | 'viewer';

export interface IWorkspace {
  id: string | null;
  owner_id?: string;
  name: string;
  role: WorkspaceRole;
  viewer_code?: string | null;
  editor_code?: string | null;
}

export interface IWorkspaceMember {
  user_id: string;
  name: string;
  email: string;
  role: 'viewer' | 'editor';
}

const PERSONAL: IWorkspace = { id: null, name: 'Personal', role: 'owner' };

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  private base = '/workspaces';
  private _list = signal<IWorkspace[]>([PERSONAL]);
  private _activeId = signal<string | null>(null);

  readonly list = this._list.asReadonly();
  readonly activeId = this._activeId.asReadonly();
  readonly active = computed<IWorkspace>(() => {
    return this._list().find((w) => w.id === this._activeId()) ?? PERSONAL;
  });

  async load(): Promise<void> {
    const { data } = await http.get<IWorkspace[]>(this.base);
    this._list.set([PERSONAL, ...data]);
  }

  async create(name: string): Promise<IWorkspace> {
    const { data } = await http.post<IWorkspace>(this.base, { name });
    this._list.update((l) => [...l, data]);
    return data;
  }

  async join(code: string): Promise<IWorkspace> {
    const { data } = await http.post<IWorkspace>(`${this.base}/join`, { code });
    this._list.update((l) => {
      const existing = l.findIndex((w) => w.id === data.id);
      if (existing >= 0) {
        const next = [...l];
        next[existing] = { ...next[existing], ...data };
        return next;
      }
      return [...l, data];
    });
    return data;
  }

  async rename(id: string, name: string): Promise<void> {
    await http.patch(`${this.base}/${id}`, { name });
    this._list.update((l) => l.map((w) => (w.id === id ? { ...w, name } : w)));
  }

  async rotateCode(id: string, kind: 'viewer' | 'editor'): Promise<string> {
    const body = kind === 'viewer' ? { rotate_viewer_code: true } : { rotate_editor_code: true };
    const { data } = await http.patch<{ viewer_code?: string; editor_code?: string }>(
      `${this.base}/${id}`,
      body,
    );
    const code = kind === 'viewer' ? data.viewer_code! : data.editor_code!;
    this._list.update((l) =>
      l.map((w) => (w.id === id ? ({ ...w, [`${kind}_code`]: code } as IWorkspace) : w)),
    );
    return code;
  }

  async disableCode(id: string, kind: 'viewer' | 'editor'): Promise<void> {
    const body = kind === 'viewer' ? { disable_viewer_code: true } : { disable_editor_code: true };
    await http.patch(`${this.base}/${id}`, body);
    this._list.update((l) =>
      l.map((w) => (w.id === id ? ({ ...w, [`${kind}_code`]: null } as IWorkspace) : w)),
    );
  }

  async delete(id: string): Promise<void> {
    await http.delete(`${this.base}/${id}`);
    this._list.update((l) => l.filter((w) => w.id !== id));
    if (this._activeId() === id) this._activeId.set(null);
  }

  async leave(id: string): Promise<void> {
    await http.delete(`${this.base}/${id}/leave`);
    this._list.update((l) => l.filter((w) => w.id !== id));
    if (this._activeId() === id) this._activeId.set(null);
  }

  async members(id: string): Promise<IWorkspaceMember[]> {
    const { data } = await http.get<IWorkspaceMember[]>(`${this.base}/${id}/members`);
    return data;
  }

  async kick(id: string, userId: string): Promise<void> {
    await http.delete(`${this.base}/${id}/members/${userId}`);
  }

  setActive(id: string | null): void {
    this._activeId.set(id);
  }
}
