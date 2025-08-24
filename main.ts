import {
	App,
	Editor,
	MarkdownView,
	Modal,
	Notice,
	Plugin,
	TAbstractFile,
	TFile,
	TFolder,
	normalizePath,
	EditorPosition,
} from "obsidian";

const TOP_FOLDER_SCOPE = "Uni Notes"; // Only run inside this top folder.
const ASSETS_DIR_NAME = "assets";

export default class PasteToNearestAssets extends Plugin {
	async onload() {
		this.registerEvent(
			this.app.workspace.on(
				"editor-paste",
				async (
					evt: ClipboardEvent,
					editor: Editor,
					view: MarkdownView,
				) => {
					try {
						if (!view?.file) return;
						if (!this.isInScope(view.file)) return;

						const fileList = evt.clipboardData?.files;
						if (!fileList || fileList.length === 0) return;

						// Find first image in the clipboard
						const imageFile = Array.from(fileList).find((f) =>
							f.type.startsWith("image/"),
						);
						if (!imageFile) return;

						// We are handling it; stop the default paste
						evt.preventDefault();
						evt.stopPropagation();

						// Save current selection
						const selectFrom = editor.getCursor("from");
						const selectTo = editor.getCursor("to");

						const activeFile = view.file;
						const startFolder = activeFile.parent;
						if (!startFolder) {
							new Notice(
								"No parent folder for the current file.",
							);
							return;
						}

						// Find nearest 'assets' folder walking up; if none, create under start
						const assetsFolder =
							(await this.findNearestAssetsFolder(startFolder)) ??
							(await this.ensureAssetsUnder(startFolder));

						if (!assetsFolder) {
							new Notice(
								"Could not locate or create assets folder.",
							);
							return;
						}

						const defaultBase = this.defaultPasteBasename();
						const prefix = this.makeNamePrefix(activeFile.basename);
						const ext =
							this.getExtFromMime(imageFile.type) ?? "png";

						const name = await NamePromptModal.open(
							this.app,
							defaultBase,
							ext,
							prefix,
						);
						if (name == null) {
							// user cancelled
							return;
						}

						const safeBase = this.sanitizeBase(name) || defaultBase;
						const targetPath = await this.getUniquePath(
							assetsFolder,
							safeBase,
							ext,
						);

						const arrayBuf = await imageFile.arrayBuffer();
						const created = await this.app.vault.createBinary(
							targetPath,
							arrayBuf,
						);

						// Insert relative markdown image link
						const link = this.app.fileManager.generateMarkdownLink(
							created,
							activeFile.path,
						);

						const targetView =
							this.app.workspace.getActiveViewOfType(
								MarkdownView,
							);

						const targetEditor = targetView?.editor ?? editor;

						// Sava scroll position before maniuplating selection
						const scrollInfo = targetEditor.getScrollInfo();

						targetEditor.focus();
						targetEditor.setSelection(selectFrom, selectTo);
						targetEditor.replaceSelection(link);

						const endPos = this.computeEndPos(selectFrom, link);
						targetEditor.setCursor(endPos);

						// restore scroll pos
						targetEditor.scrollTo(scrollInfo.left, scrollInfo.top);

						setTimeout(() => {
							targetEditor.setCursor(endPos);
							targetEditor.scrollTo(
								scrollInfo.left,
								scrollInfo.top,
							);
						}, 0);
					} catch (e: any) {
						console.error(e);
						new Notice(
							"Paste to assets failed: " + e?.message ?? e,
						);
					}
				},
			),
		);
	}

	makeNamePrefix(basename: string): string {
		const cleaned = this.sanitizeBase(basename);

		return cleaned ? `${cleaned}-` : "";
	}

	isInScope(file: TFile): boolean {
		if (!TOP_FOLDER_SCOPE) return true;
		const scopePrefix = TOP_FOLDER_SCOPE.endsWith("/")
			? TOP_FOLDER_SCOPE
			: TOP_FOLDER_SCOPE + "/";
		return file.path.startsWith(scopePrefix);
	}

	async findNearestAssetsFolder(start: TFolder): Promise<TFolder | null> {
		let cur: TFolder | null = start;
		while (cur) {
			const child = cur.children.find(
				(c) =>
					c instanceof TFolder &&
					c.name.toLowerCase() === ASSETS_DIR_NAME,
			);
			if (child instanceof TFolder) return child;
			cur = cur.parent;
		}
		return null;
	}

	async ensureAssetsUnder(folder: TFolder): Promise<TFolder | null> {
		const path = normalizePath(
			[folder.path === "/" ? "" : folder.path, ASSETS_DIR_NAME]
				.filter(Boolean)
				.join("/"),
		);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFolder) return existing;
		if (existing) {
			new Notice(
				`A non-folder named '${ASSETS_DIR_NAME}' exists at ${path}.`,
			);
			return null;
		}
		await this.app.vault.createFolder(path);
		const created = this.app.vault.getAbstractFileByPath(path);
		return created instanceof TFolder ? created : null;
	}

	defaultPasteBasename(): string {
		const d = new Date();
		const pad = (n: number) => n.toString().padStart(2, "0");
		const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(
			d.getDate(),
		)}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
		return `Pasted image ${stamp}`;
	}

	sanitizeBase(s: string): string {
		// Remove illegal filename chars and trim
		const cleaned = s
			.replace(/[\\/:*?"<>|]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		// Avoid empty or dot-only names
		if (!cleaned || /^[.]+$/.test(cleaned)) return "";
		return cleaned;
	}

	getExtFromMime(mime: string | null): string | null {
		if (!mime) return null;
		const map: Record<string, string> = {
			"image/png": "png",
			"image/jpeg": "jpg",
			"image/jpg": "jpg",
			"image/webp": "webp",
			"image/gif": "gif",
			"image/svg+xml": "svg",
			"image/heic": "heic",
			"image/heif": "heif",
		};
		return map[mime] ?? null;
	}

	async getUniquePath(
		folder: TFolder,
		base: string,
		ext: string,
	): Promise<string> {
		const dir = folder.path === "/" ? "" : folder.path;
		const make = (i: number) =>
			normalizePath(
				[dir, i === 0 ? `${base}.${ext}` : `${base} ${i}.${ext}`]
					.filter(Boolean)
					.join("/"),
			);
		let i = 0;
		let candidate = make(i);
		while (this.exists(candidate)) {
			i += 1;
			candidate = make(i);
		}
		return candidate;
	}

	exists(path: string): boolean {
		const f: TAbstractFile | null =
			this.app.vault.getAbstractFileByPath(path);
		return !!f;
	}

	private computeEndPos(from: EditorPosition, text: string): EditorPosition {
		const lines = text.split("\n");

		if (lines.length === 1) {
			return { line: from.line, ch: from.ch + lines[0].length };
		}

		return {
			line: from.line + (lines.length - 1),
			ch: lines[lines.length - 1].length,
		};
	}
}

class NamePromptModal extends Modal {
	private resolve!: (v: string | null) => void;
	private defaultBase: string;
	private prefix: string;
	private ext: string;
	private resolved = false;
	private inputEl!: HTMLInputElement;

	constructor(app: App, defaultBase: string, ext: string, prefix: string) {
		super(app);
		this.defaultBase = defaultBase;
		this.ext = ext;
		this.prefix = prefix;
	}

	static open(app: App, defaultBase: string, ext: string, prefix: string) {
		return new Promise<string | null>((resolve) => {
			const m = new NamePromptModal(app, defaultBase, ext, prefix);
			m.resolve = resolve;
			m.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h3", { text: "Name your image" });

		const wrapper = contentEl.createDiv({ cls: "ptna-input-wrap" });
		this.inputEl = wrapper.createEl("input", { type: "text" });

		const initialValue = this.prefix + this.defaultBase;
		this.inputEl.value = initialValue;

		this.inputEl.style.width = "100%";
		this.inputEl.focus();

		const start = this.prefix.length;
		const end = initialValue.length;

		this.inputEl.setSelectionRange(start, end);

		const hint = contentEl.createEl("div", {
			text: `Extension will be .${this.ext}`,
		});
		hint.style.opacity = "0.7";
		hint.style.fontSize = "12px";
		hint.style.marginTop = "4px";

		const buttons = contentEl.createDiv({ cls: "ptna-buttons" });
		const saveBtn = buttons.createEl("button", { text: "Save" });
		const cancelBtn = buttons.createEl("button", { text: "Cancel" });
		saveBtn.addEventListener("click", () => this.finish());
		cancelBtn.addEventListener("click", () => this.cancel());
		this.inputEl.addEventListener("keydown", (e) => {
			if (e.key === "Enter") this.finish();
			if (e.key === "Escape") this.cancel();
		});
	}

	onClose(): void {
		if (!this.resolved) this.resolve(null);
	}

	private finish() {
		this.resolved = true;
		let value = (this.inputEl.value ?? "").trim();
		if (!value) value = this.prefix + this.defaultBase;
		this.close();

		this.resolve(value);
	}

	private cancel() {
		this.resolved = true;
		this.close();
		this.resolve(null);
	}
}
