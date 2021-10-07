import { readdirSync } from 'fs';
import Logger from './Logger.js';
import Server from './Server.js';
import Command from './Command.js';
import * as functions from './Functions.js';
import { APIApplicationCommand } from 'discord-api-types';
import superagent from 'superagent';
import Database from './Database.js';
import * as Sentry from '@sentry/node';

export default class Client {
  token: string;
  id: string;
  publicKey: string;
  port: number;
  commands: Command[];
  console: Logger;
  functions: typeof functions;
  server: Server;
  database: Database;

  static COLORS = {
    WHITE: 0xffffff,
    BLURPLE: 0x5865f2,
    GREYPLE: 0x99aab5,
    DARK_BUT_NOT_BLACK: 0x2c2f33,
    NOT_QUITE_BLACK: 0x23272a,
    GREEN: 0x57f287,
    YELLOW: 0xfee7c,
    FUSCHIA: 0xeb459e,
    RED: 0xed4245,
    BLACK: 0xffffff,
    BLUE: 0x3498db,
  } as const;
  static EMOTES = {
    checkmark: ':white_check_mark:',
    xmark: ':x:',
    time: ':stopwatch:',
    question: ':question:',
    gear: ':gear:',
  } as const;
  suggestCooldowns: {
    [id: string]: number;
  };

  constructor({
    token,
    applicationId,
    publicKey,
    port,
  }: {
    token: string;
    applicationId: string;
    publicKey: string;
    port: number;
  }) {
    this.token = token;
    this.id = applicationId;
    this.publicKey = publicKey;
    this.port = port;

    if (!this.devMode || !process.env.SENTRY_DSN) {
      Sentry.init({ dsn: process.env.SENTRY_DSN });
      process.on('unhandledRejection', err => {
        Sentry.captureException(err);
      });
    }

    this.commands = [];
    this.console = new Logger('ToD');
    this.functions = functions;
    this.server = new Server(this.port, this);
    this.database = new Database(this);

    this.suggestCooldowns = {};
  }

  get devMode() {
    return process.argv.includes('dev');
  }

  get inviteUrl() {
    return `https://discord.com/oauth2/authorize?client_id=${this.id}&permissions=19456&scope=bot%20applications.commands`;
  }

  get COLORS() {
    return Client.COLORS;
  }
  get EMOTES() {
    return Client.EMOTES;
  }

  async start() {
    this.console.log(`Starting Truth or Dare...`);
    await this.loadCommands();
    if (this.devMode)
      this.console.log((await this.compareCommands()) ? 'Changes detected' : 'No changes detected');
    else await this.updateCommands();
    this.console.success(`Loaded ${this.commands.length} commands!`);
    await this.database.start();
    this.server.start();
  }

  async loadCommands() {
    const commandFileNames = readdirSync(`${__dirname}/../commands`).filter(f => f.endsWith('.js'));
    for (const commandFileName of commandFileNames) {
      const commandFile: Command = (await import(`../commands/${commandFileName}`)).default;
      this.commands.push(commandFile);
    }
  }

  async compareCommands(): Promise<boolean> {
    const commandList: APIApplicationCommand[] = await superagent
      .get(`https://discord.com/api/v9/applications/${this.id}/commands`)
      .set('Authorization', 'Bot ' + this.token)
      .then(res => res.body);

    return this.commands.some(
      com =>
        !this.functions.deepEquals(
          com,
          commandList.find(c => c.name === com.name),
          ['category', 'perms', 'run']
        )
    );
  }

  async updateCommands() {
    if (!(await this.compareCommands())) return;
    this.console.log('Updating commands...');

    await superagent
      .put(`https://discord.com/api/v9/applications/${this.id}/commands`)
      .set('Authorization', 'Bot ' + this.token)
      .send(
        this.commands.map(c => ({
          ...c,
          perms: undefined,
        }))
      );
    this.console.success(`Updated ${this.commands.length} slash commands`);
  }
}
