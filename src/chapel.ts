import { execSync } from "child_process";
import path from "path";
import fs from "fs";

export type ChapelDiagnostic = {
	type: string;
	file: string; 
	line: number; 
	message: string
}

const parse_error_line = (error_line: String): ChapelDiagnostic => {

	const parts = error_line.split(":").map(str => str.trim());

	const file = parts[0];
	const line = parseInt(parts[1]);
	const type = parts[2];
	const message = parts.slice(2).join(":");

	return {type, line, file, message};
}

type LspRoot = string | undefined | null;

const find_root = (target_file: string): LspRoot => {
	let dir = path.dirname(target_file);
	while (dir != "/") {
		let files = fs.readdirSync(dir);

		if (files.includes(".chapel_lsp")) {
			return dir;
		} else if (files.includes(".git")) {
			break;
		}

		dir = path.parse(dir).dir;
	}
	return undefined;
}

const read_includes = (root_dir: LspRoot): string[] => {
	if (!root_dir) {
		return [];
	}

	let includes_file = path.join(root_dir, '.chapel_lsp');

	if (!fs.existsSync(includes_file)) {
		return [];
	}

	let text = fs.readFileSync(includes_file, "utf8");

	const lines = text.split("\n")
					  .map(str => str.trim())
					  .filter(str => str != "");

	const includes = lines.map(filePath => path.join(root_dir!, filePath))
						  .map(line => `-M ${line}`);
	return includes
}


const run_chapel = (target_file: string, root_dir: LspRoot): Array<string> => {

	const includes = read_includes(root_dir);

	const command = ['chpl', target_file]
		.concat(["--no-codegen", "--baseline"])
		.concat(includes)
		.join(' ');

	try {
		execSync(command, {stdio: "pipe"});
		return [];
	} catch (exception: any) {
		const stderr = exception.stderr.toString('utf8');
		const lines = stderr.trim().split("\n");
		return lines;
	}
}

/* The LSP server library returns URIs with the protocol in front
 * e.g .file://<path>
 * This function cleans that away so that we can use the paths easily
 */
const cleanUri = (str: LspRoot): LspRoot => {

	if (!str) {
		return str;
	}

	if (str.startsWith("file:\/\/\/")) {
		str = str.slice(7);
	}
	return str;
}



export const diagnose = (targetPath: string, lspRoot: LspRoot): ChapelDiagnostic[] => {
	targetPath = cleanUri(targetPath)!;
	lspRoot = cleanUri(lspRoot);

	if (!lspRoot) {
		lspRoot = find_root(targetPath);
	}

	let errors = run_chapel(targetPath, lspRoot);
	let diags = errors.map(parse_error_line);
	return diags;
}
