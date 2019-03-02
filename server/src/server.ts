import * as WebSocket from 'ws';
import * as Jimp from 'jimp';

const SUBMARINES_PER_PLAYER = 5;
const SUBMARINE_SPOT_RADIUS = 15;
const SUBMARINE_RANGE = 10;
const BOUY_SPOT_RADIUS = 15;
const BLAST_RADIUS = 5;

function randomString(length: number): string {
    return new Array(length)
        .fill(0)
        .map((x, i) => String.fromCharCode(97 + (26*Math.random())|0))
        .join("");
}

function shuffle(a: any[]): any[] {
    var j, x, i;
    for (i = a.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        x = a[i];
        a[i] = a[j];
        a[j] = x;
    }
    return a;
}

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

    getTilesOfType(tileType: TileType): Coordinate[] {
        const result: Coordinate[] = [];
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.width; y++) {
                const position = new Coordinate(x, y);
                if (this.getTileType(position) === tileType) {
                    result.push(position);
                }
            }
        }

        return result;
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
    x: number;
    t: string;
    p?: number;
    id?: number;
}

class Game {
    public id: string;
    public players: Player[] = [];
    public submarines: Submarine[] = [];
    public bouys: Bouy[] = [];
    public currentTurn: Player | null = null;

    constructor(public map: Map) {
        this.id = randomString(10);
    }

    info(message: string) {
        console.log("[Game " + this.id + "] " + message);
    }

    initialize() {
        let submarineId = 1;
        let playerIdx = 0;
        for (const player of this.players) {

            let tileType;
            if (playerIdx === 0) {
                tileType = TileType.PLAYER1_SPAWN;
            } else if (playerIdx === 1) {
                tileType = TileType.PLAYER2_SPAWN;
            } else {
                throw new Error("Cannot support more than two players per game.");
            }

            let spawnPositions = this.map.getTilesOfType(tileType);

            shuffle(spawnPositions);

            for (let i = 0; i < SUBMARINES_PER_PLAYER; i++) {
                const position = spawnPositions.pop();
                if (!position) {
                    throw new Error("No valid spawn location found for submarine.");
                }

                this.submarines.push(new Submarine(
                    submarineId++,
                    player,
                    position,
                ));
            }

            playerIdx++;
        }

        if (Math.random() > 0.5) {
            this.currentTurn = this.players[0];
        } else {
            this.currentTurn = this.players[1];
        }

        for (const player of this.players) {
            player.sendEvent({
                eventType: 'game_start',
                firstPlayer: this.currentTurn.id,
            });
        }

        this.info("Game started. First player is " + this.currentTurn.id);

        this.sendMapToClients();
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
                            x,
                            t: 'submarine',
                            p: submarine.owner.id,
                            id: submarine.id,
                        });
                    }
                } else if (bouy) {
                    row.push({
                        x,
                        t: 'bouy',
                        p: bouy.owner.id,
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

        this.info("New turn. Current player is " + this.currentTurn.id);
    }

    sendMapToClients() {
        const rows : number[][] = [];
        for (let y = 0; y < this.map.height; y++) {
            const row : number[] = [];
            for (let x = 0; x < this.map.width; x++) {
                const position = new Coordinate(x, y);
                const tileType = this.map.getTileType(position);
                const submarine = this.submarines.filter((submarine) => submarine.position.eq(position)).pop();
                const bouy = this.bouys.filter((bouy) => bouy.position.eq(position)).pop();

                if (tileType === TileType.LAND) {
                    row.push(x);
                }
            }

            rows.push(row);
        }

        for (const player of this.players) {
            player.sendEvent({
                eventType: 'map',
                width: this.map.width,
                height: this.map.height,
                map: rows,
            });
        }
    }

    sendStateToClients() {
        for (const player of this.players) {
            player.sendEvent({
                eventType: 'state_update',
                currentPlayer: this.currentTurn ? this.currentTurn.id : 0,
                map: this.renderMapForPlayer(player),
            });
        }
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

        console.log("[Player " + player.id + "] Connected");

        player.sendEvent({
            eventType: 'connected',
            playerId: player.id,
        });

        ws.on('message', function(message: string) {
            const command : Command = JSON.parse(message);

            console.log("[Player " + player.id + "] " + message);

            // TODO: chat support

            try {
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

                    // stop people from joining ongoing games
                    if (game.players.length >= 2) {
                        player.sendError('game_full');
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

                    (command.position as any).__proto__ = Coordinate.prototype;
                    player.game.placeBouy(player, command.position);
                } else if (command.commandType === 'depthCharge') {
                    if (!player.game) {
                        player.sendError('not_in_game');
                        return;
                    }

                    (command.position as any).__proto__ = Coordinate.prototype;
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
                    if (submarine.owner.id !== player.id) {
                        player.sendError('not_your_submarine');
                        return;
                    }

                    (command.position as any).__proto__ = Coordinate.prototype;
                    game.moveSubmarine(submarine, command.position);
                } else {
                    console.log("Unknown command: " + message);
                }
            } catch (e) {
                console.log(e);
            }
        });
    });

    console.log("Server started!");
}

runGame();
