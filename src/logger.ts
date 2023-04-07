import { format, createLogger, transports } from 'winston';


const logFile = "./chapel_lsp_logs.log";

const getLogLevel = () => {
	const allowedLevels = ["none", "warn", "info", "error"];
	const argv = require('minimist')(process.argv.slice(2));
	const level = argv["logging"];
	return allowedLevels.includes(level) ? level : 'none';
}

const getTransport = (level: string) => {
	if (level == "none") {
		const transport = new transports.Console({});
		transport.silent = true;
		return transport;
	} else {
		return new transports.File({filename: logFile});
	}
}

const makeLogger = () => {
	const level = getLogLevel();

	const logger = createLogger({
		level: level,
		format: format.combine(
			format.timestamp(),
			format.json(),
		),
		defaultMeta: { service: 'chapel-lsp' },
		transports: [ getTransport(level) ],
	});
	return logger;
}

export const logger = makeLogger();

export const info = (message: string) => {
	logger.log({ level: 'info', message });
}

export const error = (message: string) => {
	logger.log({ level: 'error', message });
}
