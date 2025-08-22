import { App, Editor, MarkdownView, Modal, Notice, Plugin } from "obsidian";

export default class CustomPastePlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerDomEvent(document, "paste", (event: ClipboardEvent) => {
			const activeView =
				this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!activeView) return;

			const editor = activeView.editor;

			const items = event.clipboardData?.items;
			if (!items) return;

			for (const item of Array.from(items)) {
				if (item.type.startsWith("images/")) {
					event.preventDefault();
					this.handleImagePaste(item, editor, activeView);
				}
			}
		});
	}

	async handleImagePaste(
		item: DataTransferItem,
		editor: Editor,
		view: MarkdownView,
	) {
		const file = item.getAsFile();
		if (!file) return;

		const notePath = view.file?.path;
		if (!notePath) return;

		const assetsFolder = this.findAssetFolder(notePath);

		// TODO:: adjust for the generic use case  where assets folder does not exist later
		if (!assetsFolder) {
			new Notice("No assets folder found in parent directories");
			return;
		}

		const filename = await this.promptForFileName(file.name);

		const arrayBuffer = await file.arrayBuffer();
		const ext = file.type.split("/")[1];

		const finalName = `${filename}.${ext}`;
		const finalPath = `${assetsFolder}/${finalName}`;

		await this.app.vault.createBinary(finalPath, arrayBuffer);

		editor.replaceSelection(`![](${finalPath})`);
		new Notice(`Image saved as ${finalPath}`);
	}

	findAssetFolder(path: string): string | null {
		const parts = path.split("/");
		parts.pop();

		while (parts.length > 0) {
			const candidate = parts.join("/") + "/assets";

			if (this.app.vault.getAbstractFileByPath(candidate)) {
				return candidate;
			}

			parts.pop();
		}

		return null;
	}

	promptForFileName(defaultName: string): Promise<string> {
		return new Promise((resolve) => {
			const modal = new FilenameModal(this.app, defaultName, resolve);
			modal.open();
		});
	}
}

class FilenameModal extends Modal {
	defaultName: string;
	onSubmit: (name: string) => void;

	constructor(
		app: App,
		defaultName: string,
		onSubmit: (name: string) => void,
	) {
		super(app);
		this.defaultName = defaultName.replace(/\.[^/.]+$/, ""); // strip extension
		this.onSubmit = onSubmit;
	}
	onOpen() {
		const { contentEl } = this;

		contentEl.createEl("h2", {
			text: "Enter image filename",
		});

		const input = contentEl.createEl("input", {
			type: "text",
			value: this.defaultName,
		});

		input.focus();

		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				this.close();
				this.onSubmit(input.value || this.defaultName);
			}
		});

		const submitButton = contentEl.createEl("button", { text: "Save" });

		submitButton.onclick = () => {
			this.close();
			this.onSubmit(input.value || this.defaultName);
		};
	}

	onClose() {
		this.contentEl.empty();
	}
}
