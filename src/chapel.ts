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
	const message = parts.slice(3).join(":");

	return {type, line, file, message};
}

const find_root = (target_file: string): string | undefined => {
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

const read_includes = (target_file: string): Array<string> => {
	let root_dir = find_root(target_file);
	if (root_dir == undefined) {
		return [];
	}

	let includes_file = path.join(root_dir, '.chapel_lsp');
	let text = fs.readFileSync(includes_file, "utf8");

	const lines = text.split("\n")
					  .map(str => str.trim())
					  .filter(str => str != "");

	const includes = lines.map(filePath => path.join(root_dir!, filePath))
						  .map(line => `-M ${line}`);
	return includes
}


const run_chapel = (target_file: string): Array<string> => {

	const includes = read_includes(target_file);

	const command = ['chpl', target_file]
		.concat(["--no-codegen", "--baseline"])
		.concat(includes)
		.join(' ');

	console.log(command);
	
	try {
		execSync(command, {stdio: "pipe"});
		return [];
	} catch (exception: any) {
		const stderr = exception.stderr.toString('utf8');
		const lines = stderr.trim().split("\n");
		return lines;
	}
}

export const diagnose =(target_file: string): Array<ChapelDiagnostic> => {
	let errors = run_chapel(target_file);
	let diags = errors.map(parse_error_line);
	return diags;
}
