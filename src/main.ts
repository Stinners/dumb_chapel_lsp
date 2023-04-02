import {
	createConnection,
	TextDocuments,
	Diagnostic,
	DiagnosticSeverity,
	ProposedFeatures,
	InitializeParams,
	DidChangeConfigurationNotification,
	TextDocumentSyncKind,
	InitializeResult,
    ServerCapabilities,
	TextDocumentSyncOptions,
    TextDocumentChangeEvent,
} from 'vscode-languageserver/node';

import {
	TextDocument
} from 'vscode-languageserver-textdocument';

import { diagnose, ChapelDiagnostic } from "./chapel";
import winston from 'winston';


const logFile = "/home/chris/Code/Experiments/Chapel/dumb_chapel_lsp/lsp_logs.log";

const logger = winston.createLogger({
	level: 'info',
	format: winston.format.json(),
	defaultMeta: { service: 'chapel-lsp' },
	transports: [
		new winston.transports.File({ filename: logFile })
	]
});

const info = (message: string) => {
	logger.log({ level: 'info', message });
}

/*==========================================================
 *                     Starting Server 
  ========================================================== */

info('Starting Server');

let connection = createConnection(ProposedFeatures.all);
let documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
//let hasDiagnosticRelatedInformationCapability = false;

// The value for the root directory found by the LSP Client
let lspRoot: string | null | undefined = undefined;

connection.onInitialize((params: InitializeParams) => {
	info("onInitialize Event");

	if (params.workspaceFolders && params.workspaceFolders.length != 0) {
		lspRoot = params.workspaceFolders[0].uri;
	}
	info(`Client Root ${lspRoot}`);

	let capabilities = params.capabilities;

	hasConfigurationCapability = !!(
		capabilities.workspace && !!capabilities.workspace.configuration
	);

	hasWorkspaceFolderCapability = !!(
		capabilities.workspace && !!capabilities.workspace.workspaceFolders
	);

	/*
	hasDiagnosticRelatedInformationCapability = !!(
		capabilities.textDocument &&
		capabilities.textDocument.publishDiagnostics &&
		capabilities.textDocument.publishDiagnostics.relatedInformation
	);
	*/

	const result: InitializeResult = {
		capabilities: <ServerCapabilities>{
			textDocumentSync: <TextDocumentSyncOptions>{
				openClose: true,
				change: TextDocumentSyncKind.Incremental,
				willSave: true,
				willSaveWaitUntil: true,
				save: true,
			},
			completionProvider: { 
				resolveProvider: false
			}
		}
	}

	if (hasWorkspaceFolderCapability) {
		result.capabilities.workspace = {
			workspaceFolders: {
				supported: true
			}
		};
	}
	return result;
});

connection.onInitialized(() => {
	info("onInitialized Event");
	if (hasConfigurationCapability) {
		connection.client.register(DidChangeConfigurationNotification.type, undefined);
	}

	if (hasWorkspaceFolderCapability) {
		connection.workspace.onDidChangeWorkspaceFolders(_event => {
			connection.console.log("Workspace folder change event recieved");
		})
	};
});

/*==========================================================
 *                       Settings
  ========================================================== */


interface Settings {
	maxNumberOfProblems: number;
}

const defaultSettings: Settings = { 
	maxNumberOfProblems: 10,
};
let globalSettings: Settings = defaultSettings;

//let documentSettings: Map<string, Thenable<Settings>> = new Map();

connection.onDidChangeConfiguration(_change => {
	// Don't do anything here for now - this probably wont actually get called 
	info("onDidChangeConfiguration Event");
});

documents.onDidClose(_e => {
	info("onDidClose Event");
});

documents.onDidChangeContent(_change => {
	info("onDidChange Event");
});

documents.onDidSave((change: TextDocumentChangeEvent<TextDocument>) => {
	info("onDidSave Event");

	let textDocument = change.document;
	let targetPath = textDocument.uri;
	let chapelDiags: ChapelDiagnostic[] = [];
	try {
		chapelDiags = diagnose(targetPath, lspRoot);
	} catch (exception) {
		info(`Exception: ${exception}`);
		return;
	}

	let diagnostics: Diagnostic[] = [];
	chapelDiags.forEach(chapelDiag => {
		info(`Diagnostic Line: ${chapelDiag.line}`);
		let diagnostic: Diagnostic = {
			severity: DiagnosticSeverity.Error,
			range: {
				start: { line: chapelDiag.line-1, character: 0 },
				end: { line: chapelDiag.line-1, character: 0 },
			},
			message: chapelDiag.message,
			source: "Chapel LSP",
		};
		diagnostics.push(diagnostic);
	});

	info(`Sending Diagnostics`);
	connection.sendDiagnostics({ uri: targetPath, diagnostics });
});

connection.onDidChangeWatchedFiles(_change => {
	info("onDidChangeWatchedFiles Event");
});

documents.listen(connection);
connection.listen();
