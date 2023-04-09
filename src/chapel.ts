import { execSync } from "child_process";
import path from "path";
import fs from "fs";

import { info, error } from "./logger";

export type ChapelDiagnostic = {
	type: string;
	file: string; 
	line: number; 
	message: string
}

type LspRoot = string | undefined | null;

const parse_error_line = (error_line: String): ChapelDiagnostic | undefined => {
	const parts = error_line.split(":").map(str => str.trim());
	if (parts.length < 3) {
		return undefined;
	}

	const file = parts[0];
	const line = parseInt(parts[1]);
	const type = parts[2];
	const message = parts.slice(2).join(":");

	if (typeof(line) != 'number') {
		error(`Invalid line number: ${line} parsed from line: ${error_line}`);
		return undefined;
	}

	return {type, line, file, message};
}


const findRoot = (target_file: string): LspRoot => {
	let dir = path.dirname(target_file);
	while (dir != "/") {
		let files = fs.readdirSync(dir);

		const hasRootFile = files.includes(".chapel_lsp")
							|| files.includes(".git")
							|| files.includes("mason.toml");

		if (hasRootFile) {
			return dir;
		}

		dir = path.parse(dir).dir;
	}
	return undefined;
}

const lspFileIncludes = (root_dir: string): Set<string> => {
	const includes_file = path.join(root_dir, '.chapel_lsp');

	if (!fs.existsSync(includes_file)) {
		return new Set();
	}

	const text = fs.readFileSync(includes_file, "utf8");

	const lines = text.split("\n")
					  .map(str => str.trim())
					  .filter(str => str != "")
					  .map(filePath => path.join(root_dir, filePath));
	
	return new Set(lines);
}

const srcDirIncludes = (root_dir: string) : Set<string> => {
	let includeDirs = new Set<string>();
	const paths = [path.join(root_dir, "src/")];


	while (paths.length != 0) {
		let dir = paths.pop();
		if (!dir || !fs.existsSync(dir)) {
			continue;
		}

		let children = fs.readdirSync(dir);
		let hasChplFiles = false;

		for (let child_name of children) {
			let child = path.join(dir, child_name);
			if (fs.lstatSync(child).isDirectory()) {
				paths.push(child);
			} else if (path.extname(child) == ".chpl") {
				hasChplFiles = true;
			}
		}

		if (hasChplFiles) {
			includeDirs.add(dir);
		}
	}
	return includeDirs;
}

const read_includes = (root_dir: string): string[] => {
	const fileIncludes = lspFileIncludes(root_dir);
	const srcIncludes = srcDirIncludes(root_dir);
	const allIncludes = new Set([...fileIncludes, ...srcIncludes]);

	const includes = [...allIncludes].map(line => `-M ${line}`);

	return includes
}
const groupBy = <T>(array: T[], grouper: any): T[][] => {
	let groups = {};
	for (let val of array) {
		let group = grouper(val);

		if (!groups[group]) { groups[group] = [] };
		groups[group].push(val);
	}
	return Object.values(groups);
}

const processErrorLines = (diags: ChapelDiagnostic[]): ChapelDiagnostic[] => {
	let processedDiags: ChapelDiagnostic[] = [];

	const groups = groupBy<ChapelDiagnostic>(diags, (diag: ChapelDiagnostic) => [diag.file, diag.line]);
	for (let group of groups) {
		// Skip lines pointing to the Chapel stdlib 
		if (group[0].file.startsWith("$CHPL_HOME")) {
			continue;
		}
		// Join lines relating to the same source line
		else {
			let combined = group[0];
			for (let diag of group.slice(1)) {
				combined.message += " " + diag.message;
			}
			processedDiags.push(combined);
		}
	}
	return processedDiags;
}


const run_chapel = (target_file: string, includes: string[]): Array<string> => {

	const command = ['chpl', target_file]
		.concat(["--no-codegen", "--baseline"])
		.concat(includes)
		.join(' ');

	info(`Running: chpl ${command}`);

	try {
		// This will thrown an exception if the command returns a non-zero exit code 
		// Which is what happens when the compiler raises any errors
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
	if (str && str.startsWith("file:\/\/\/")) {
		return str.slice(7);
	} else {
		return str;
	}
}



export const diagnose = (targetPath: string, lspRoot: LspRoot): ChapelDiagnostic[] => {
	targetPath = cleanUri(targetPath)!;
	lspRoot = cleanUri(lspRoot || findRoot(targetPath));

	const includes = lspRoot ? read_includes(lspRoot) : [];

	let errors = run_chapel(targetPath, includes);
	let diags = errors.map(parse_error_line)
	                  .filter((diag): diag is ChapelDiagnostic => (diag != undefined));
	diags = processErrorLines(diags);	
	return diags;
}
