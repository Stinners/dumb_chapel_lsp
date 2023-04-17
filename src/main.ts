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

import { diagnose, ChapelDiagnostic, cleanUri } from "./chapel";
import { info, error } from "./logger";

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

	// TODO move this into a chapel specific function
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

connection.onDidChangeConfiguration(_change => {});

documents.onDidClose(_e => {});

documents.onDidChangeContent(_change => {});

documents.onDidSave((change: TextDocumentChangeEvent<TextDocument>) => {
	info("onDidSave Event");

	let textDocument = change.document;
	let thisFile = textDocument.uri;
	let filePath = cleanUri(thisFile);
	let chapelDiags: ChapelDiagnostic[] = [];
	try {
		chapelDiags = diagnose(thisFile, lspRoot);
	} catch (exception) {
		info(`Exception: ${exception}`);
		return;
	}

	info(`Open file ${textDocument.uri}`);

	let diagnostics: Diagnostic[] = [];

	for (const chapelDiag of chapelDiags) {
		info(`Diagnostic Line: ${chapelDiag.line}`);

		if (chapelDiag.file != filePath) { continue; }

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
	};

	connection.sendDiagnostics({ uri: thisFile!, diagnostics });
});

connection.onDidChangeWatchedFiles(_change => {});

documents.listen(connection);
connection.listen();
