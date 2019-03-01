import * as WebSocket from 'ws';
import * as Jimp from 'jimp';

const SUBMARINES_PER_PLAYER = 5;
const SUBMARINE_SPOT_RADIUS = 10;
const SUBMARINE_VELOCITY = 5;
const BOUY_SPOT_RADIUS = 25;
const BLAST_RADIUS = 10;

class Coordinate {
    constructor(public x: number, public y: number) {
    }
}

enum BlockType {
    WATER,
    LAND,
    PLAYER1_SPAWN,
    PLAYER2_SPAWN,
}

class Map {
    static async loadFromImage(filename: string): Promise<Map> {
        const image = await Jimp.read(filename);

        const width = image.bitmap.width;
        const height = image.bitmap.height;

        const data: BlockType[] = [];
        image.scan(0, 0, width, height,
            (x, y, idx) => {
                const red = image.bitmap.data[idx + 0];
                const green = image.bitmap.data[idx + 1];
                const blue = image.bitmap.data[idx + 2];

                if (red === 0xFF && green === 0 && blue === 0) {
                    data.push(BlockType.PLAYER1_SPAWN);
                } else if (red === 0 && green === 0 && blue === 0xFF) {
                    data.push(BlockType.PLAYER2_SPAWN);
                } else if (red === 0xFF && green === 0xFF && blue === 0xFF) {
                    data.push(BlockType.LAND);
                } else {
                    data.push(BlockType.WATER);
                }
            });

        return Promise.resolve(new Map(data, width, height));
    }

    private constructor(
        public data: BlockType[],
        public width: number,
        public height: number,
    ) { }
}

interface Event {
    eventType: string;
}

class Player {
    public game: Game | null = null;

    constructor(private ws: WebSocket) {
    }

    sendEvent<E extends Event>(event: E) {
        this.ws.send(JSON.stringify(event));
    }

    sendError(errorType: string) {
        this.ws.send(JSON.stringify({
            errorType,
        }));
    }
}

class Submarine {
    constructor(
        public id: number,
        public owner: Player,
        public position: Coordinate,
    ) { }
}

class Game {
    public id: string;
    public players: Player[] = [];
    public submarines: Submarine[] = [];

    constructor(public map: Map) {
        this.id = new Array(10)
            .fill(0)
            .map((x, i) => String.fromCharCode(97 + (26*Math.random())|0))
            .join("");
    }

    initialize() {
    }

    findSubmarine(id: number): Submarine | null {
        return this.submarines.filter((submarine) => submarine.id === id).pop() || null;
    }

    placeBouy(player: Player, position: Coordinate) {
    }

    dropDepthCharge(player: Player, position: Coordinate) {
    }

    moveSubmarine(submarine: Submarine, position: Coordinate) {
    }

    renderMapForPlayer(player: Player) {
    }

    sendStateToClients() {
    }
}

type Command = GameNewCommand | GameJoinCommand | BouyCommand | DepthChargeCommand | MoveCommand;

interface BaseCommand {
    commandType: string;
}

interface GameNewCommand extends BaseCommand {
    commandType: 'gameNew';
}

interface GameJoinCommand extends BaseCommand {
    commandType: 'gameJoin';
    gameId: string;
}

interface BouyCommand extends BaseCommand {
    commandType: 'bouy';
    position: Coordinate;
}

interface DepthChargeCommand extends BaseCommand {
    commandType: 'depthCharge';
    position: Coordinate;
}

interface MoveCommand extends BaseCommand {
    commandType: 'move';
    submarineId: number;
    position: Coordinate;
}

async function runGame() {
    const map = await Map.loadFromImage('assets/map2-lowres.png');

    const wss = new WebSocket.Server({ port: 8080 });

    const players : Player[] = [];
    const games : Game[] = [];

    wss.on('connection', function(ws: WebSocket) {
        const player = new Player(ws);
        players.push(player);

        ws.on('message', function(message: string) {
            const command : Command = JSON.parse(message);

            if (command.commandType === 'gameNew') {
                const game = new Game(map);
                game.players.push(player);
                games.push(game);

                player.game = game;

                player.sendEvent({
                    eventType: 'game_created',
                    gameId: game.id,
                });
            } else if (command.commandType === 'gameJoin') {
                const game = games.filter((game) => game.id === command.gameId).pop();
                if (!game) {
                    player.sendError('game_not_found');
                    return;
                }

                player.game = game;

                game.players.push(player);
                game.initialize();
            } else if (command.commandType === 'bouy') {
                if (!player.game) {
                    player.sendError('not_in_game');
                    return;
                }
                player.game.placeBouy(player, command.position);
            } else if (command.commandType === 'depthCharge') {
                if (!player.game) {
                    player.sendError('not_in_game');
                    return;
                }
                player.game.dropDepthCharge(player, command.position);
            } else if (command.commandType === 'move') {
                if (!player.game) {
                    player.sendError('not_in_game');
                    return;
                }

                const game = player.game;
                const submarine = game.findSubmarine(command.submarineId);
                if (!submarine) {
                    player.sendError('submarine_not_found');
                    return;
                }
                if (submarine.owner !== player) {
                    player.sendError('not_your_submarine');
                    return;
                }

                game.moveSubmarine(submarine, command.position);
            }
        });
    });
}

runGame();
