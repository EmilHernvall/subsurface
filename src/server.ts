import * as WebSocket from 'ws';
import * as Jimp from 'jimp';

const SUBMARINES_PER_PLAYER = 5;
const SUBMARINE_SPOT_RADIUS = 10;
const SUBMARINE_RANGE = 5;
const BOUY_SPOT_RADIUS = 25;
const BLAST_RADIUS = 10;

class Coordinate {
    constructor(public x: number, public y: number) {
    }

    eq(other: Coordinate): boolean {
        return this.x === other.x && this.y === other.y;
    }

    distance(other: Coordinate): number {
        return Math.sqrt(Math.pow(other.x - this.x, 2) + Math.pow(other.y - this.y, 2));
    }
}

enum TileType {
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

        const data: TileType[] = [];
        image.scan(0, 0, width, height,
            (x, y, idx) => {
                const red = image.bitmap.data[idx + 0];
                const green = image.bitmap.data[idx + 1];
                const blue = image.bitmap.data[idx + 2];

                if (red === 0xFF && green === 0 && blue === 0) {
                    data.push(TileType.PLAYER1_SPAWN);
                } else if (red === 0 && green === 0 && blue === 0xFF) {
                    data.push(TileType.PLAYER2_SPAWN);
                } else if (red === 0xFF && green === 0xFF && blue === 0xFF) {
                    data.push(TileType.LAND);
                } else {
                    data.push(TileType.WATER);
                }
            });

        return Promise.resolve(new Map(data, width, height));
    }

    private constructor(
        public data: TileType[],
        public width: number,
        public height: number,
    ) { }

    getTileType(position: Coordinate): TileType {
        return this.data[this.width*position.y + position.x];
    }
}

interface Event {
    eventType: string;
}

class Player {
    public game: Game | null = null;

    constructor(private ws: WebSocket, public id: number) {
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

class Bouy {
    constructor(
        public id: number,
        public owner: Player,
        public position: Coordinate,
    ) { }
}

interface ClientTile {
    t: string;
    p?: number;
}

class Game {
    public id: string;
    public players: Player[] = [];
    public submarines: Submarine[] = [];
    public bouys: Bouy[] = [];
    public currentTurn: Player | null = null;

    constructor(public map: Map) {
        this.id = new Array(10)
            .fill(0)
            .map((x, i) => String.fromCharCode(97 + (26*Math.random())|0))
            .join("");
    }

    initialize() {
        // TODO: create submarines for all players
        // TODO: randomize who gets to turn and assign turn

        this.sendStateToClients();
    }

    findSubmarine(id: number): Submarine | null {
        return this.submarines.filter((submarine) => submarine.id === id).pop() || null;
    }

    placeBouy(player: Player, position: Coordinate) {
        if (this.map.getTileType(position) === TileType.LAND) {
            player.sendError('cannot_place_bouy_on_land');
            return;
        }

        if (this.bouys.filter((bouy) => bouy.position.eq(position)).length > 0) {
            player.sendError('tile_already_used_for_bouy');
            return;
        }

        this.bouys.push(new Bouy(this.bouys.length + 1, player, position));

        this.nextTurn();
        this.sendStateToClients();
    }

    dropDepthCharge(player: Player, position: Coordinate) {
        if (this.map.getTileType(position) === TileType.LAND) {
            player.sendError('cannot_drop_depth_charge_on_land');
            return;
        }

        const affectedSubmarines = this.submarines.filter((submarine) => {
            return submarine.position.distance(position) <= BLAST_RADIUS;
        });

        this.submarines = this.submarines.filter((submarine) => {
            return submarine.position.distance(position) > BLAST_RADIUS;
        });

        this.nextTurn();
        this.sendStateToClients();
    }

    moveSubmarine(submarine: Submarine, target: Coordinate) {
        const player = submarine.owner;
        if (this.map.getTileType(target) === TileType.LAND) {
            player.sendError('cannot_move_submarine_onto_land');
            return;
        }
        if (submarine.position.distance(target) > SUBMARINE_RANGE) {
            player.sendError('cannot_move_submarine_that_far');
            return;
        }
        if (this.submarines.filter((submarine) => submarine.position.eq(target)).length > 0) {
            player.sendError('cannot_move_to_occupied_tile');
            return;
        }

        submarine.position = target;

        this.nextTurn();
        this.sendStateToClients();
    }

    renderMapForPlayer(player: Player): ClientTile[][] {
        const rows : ClientTile[][] = [];
        for (let y = 0; y < this.map.height; y++) {
            const row : ClientTile[] = [];
            for (let x = 0; x < this.map.width; x++) {
                const position = new Coordinate(x, y);
                const tileType = this.map.getTileType(position);
                const submarine = this.submarines.filter((submarine) => submarine.position.eq(position)).pop();
                const bouy = this.bouys.filter((bouy) => bouy.position.eq(position)).pop();

                let canSee = false;
                if (submarine) {
                    if (submarine.owner == player) {
                        canSee = true;
                    } else {
                        const inRangeOfBouy = this.bouys.filter((bouy) => {
                            return bouy.owner === player;
                        }).filter((bouy) => {
                            return bouy.position.distance(submarine.position) <= BOUY_SPOT_RADIUS
                        }).length > 0;

                        const inRangeOfSubmarine = this.submarines.filter((submarine) => {
                            return submarine.owner === player;
                        }).filter((mySubmarine) => {
                            return mySubmarine.position.distance(submarine.position) <= SUBMARINE_SPOT_RADIUS
                        }).length > 0;

                        if (inRangeOfBouy || inRangeOfSubmarine) {
                            canSee = true;
                        }
                    }

                    if (canSee) {
                        row.push({
                            t: 'submarine',
                            p: submarine.owner.id,
                        });
                    }
                } else if (bouy) {
                    row.push({
                        t: 'bouy',
                        p: bouy.owner.id,
                    });
                } else if (tileType === TileType.LAND) {
                    row.push({
                        t: 'land',
                    });
                } else {
                    row.push({
                        t: 'water',
                    });
                }
            }

            rows.push(row);
        }

        return rows;
    }

    nextTurn() {
        if (!this.currentTurn) {
            console.log("Game.nextTurn() called without a player having the turn.");
            return;
        }

        const currentIndex = this.players.indexOf(this.currentTurn);
        if (currentIndex === -1) {
            console.log("Game.nextTurn() could not find the player currently holding the turn in the list of players.");
            return;
        }

        const nextIndex = (currentIndex + 1) % this.players.length;
        this.currentTurn = this.players[nextIndex];
    }

    sendStateToClients() {
        // TODO: implement
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

    let playerSeq = 0;
    const players : Player[] = [];
    const games : Game[] = [];

    wss.on('connection', function(ws: WebSocket) {
        const player = new Player(ws, ++playerSeq);
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
