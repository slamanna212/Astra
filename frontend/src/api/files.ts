import { API_BASE, apiFetch, buildUrl } from './client';
import type { FileContent, FileListing, FileUploadResponse, GitStatus } from './types';

export function listFiles(path: string, signal?: AbortSignal): Promise<FileListing> {
  return apiFetch<FileListing>('/files', { query: { path }, signal });
}

export function getFileContent(path: string, signal?: AbortSignal): Promise<FileContent> {
  return apiFetch<FileContent>('/files/content', { query: { path }, signal });
}

export function getGitStatus(path: string, signal?: AbortSignal): Promise<GitStatus> {
  return apiFetch<GitStatus>('/files/git', { query: { path }, signal });
}

/** URL for the download/inline endpoint — used directly in `<a href>` / "open in new tab", not fetched via apiFetch. */
export function fileDownloadUrl(path: string): string {
  return buildUrl('/files/download', { path });
}

export interface UploadFileOptions {
  directory: string;
  file: File;
  overwrite?: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/**
 * Upload via XHR (not `fetch`) so we can report progress — `fetch` has no upload-progress event.
 * Streams from the browser's perspective (the body is the File itself, never buffered as a string).
 */
export function uploadFile({ directory, file, overwrite, onProgress, signal }: UploadFileOptions): Promise<FileUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/files/upload`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('X-Requested-With', 'astra');

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => {
      let body: unknown;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        body = xhr.responseText;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as FileUploadResponse);
      } else {
        const detail =
          body && typeof body === 'object' && 'detail' in body && typeof (body as { detail: unknown }).detail === 'string'
            ? (body as { detail: string }).detail
            : `Upload failed with status ${xhr.status}`;
        reject(new Error(detail));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed')));
    xhr.addEventListener('abort', () => reject(new DOMException('Upload aborted', 'AbortError')));
    signal?.addEventListener('abort', () => xhr.abort());

    const form = new FormData();
    form.set('directory', directory);
    form.set('overwrite', overwrite ? 'true' : 'false');
    form.set('file', file);
    xhr.send(form);
  });
}
