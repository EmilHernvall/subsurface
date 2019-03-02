import React, { Component, SyntheticEvent, MouseEvent } from 'react';
import logo from './logo.svg';
import './App.css';

enum ToolMode {
    SELECT_SHIP,
    MOVE_SHIP,
    DROP_DEPTH_CHARGE,
    PLACE_BOUY,
}

interface Tile {
    x: number;
    t: string;
    p?: number;
    id?: number;
}

interface GameBoardProperties {
    playerId: number;
    mapWidth: number;
    mapHeight: number;
    mapData: number[][];
    tileState: Tile[][];
    enableSelection: boolean;
    toolMode: ToolMode;
    selectedX: number;
    selectedY: number;
    onTileClick: (x: number, y: number) => void;
}

interface GameBoardState {
    scaleFactor: number;
    x: number;
    y: number;
}

function Land({ mapData, scaleFactor }: { mapData: number[][], scaleFactor: number}) {

    const tiles = mapData.map((row, y) => {
        const tiles = row.map((x, i) => {
            return (
                <rect
                    key={ i }
                    x={ x * scaleFactor }
                    y={ y * scaleFactor }
                    width={ scaleFactor }
                    height={ scaleFactor }
                    style={{ fill: "green", }}
                    />
            );
        });

        return (
            <g key={ y }>{ tiles }</g>
        );
    });

    return (
        <React.Fragment>
            { tiles }
        </React.Fragment>
    );
}

class GameBoard extends Component<GameBoardProperties, GameBoardState> {

    constructor(props: GameBoardProperties) {
        super(props);

        this.state = {
            scaleFactor: 8,
            x: 0,
            y: 0,
        };
    }

    onMouseMove(e: MouseEvent) {
        const { scaleFactor } = this.state;
        const x = (e.nativeEvent.offsetX / scaleFactor)|0;
        const y = (e.nativeEvent.offsetY / scaleFactor)|0;
        this.setState({ x, y });
    }

    onClick() {
        const { onTileClick } = this.props;
        const { x, y } = this.state;

        onTileClick(x, y);
    }

    render() {
        const {
            playerId,
            mapWidth,
            mapHeight,
            mapData,
            tileState,
            toolMode,
            selectedX,
            selectedY,
            enableSelection,
        } = this.props;
        const { scaleFactor, x, y } = this.state;

        const objects = tileState.map((row, y) => {
            return row.map((tile, i) => {
                if (tile.t === 'submarine') {
                    const style = { fill: tile.p === playerId ? "white" : "red" };
                    if (y === selectedY && tile.x === selectedX) {
                        style.fill = "magenta";
                    }

                    return (
                        <circle
                            key={ y*mapWidth + i }
                            cx={ tile.x * scaleFactor + scaleFactor/2 }
                            cy={ y * scaleFactor + scaleFactor/2 }
                            r={ scaleFactor/2 }
                            style={ style }
                            />
                    );
                } else if (tile.t === 'bouy') {
                    const style = { stroke: tile.p === playerId ? "white" : "red" };
                    return (
                        <React.Fragment key={ y*mapWidth + i }>
                            <line
                                x1={ tile.x * scaleFactor - scaleFactor/2 }
                                y1={ y * scaleFactor}
                                x2={ tile.x * scaleFactor + scaleFactor/2 }
                                y2={ y * scaleFactor}
                                style={ style }
                                />
                            <line
                                x1={ tile.x * scaleFactor }
                                y1={ y * scaleFactor - scaleFactor/2 }
                                x2={ tile.x * scaleFactor }
                                y2={ y * scaleFactor + scaleFactor/2 }
                                style={ style }
                                />
                        </React.Fragment>
                    );
                }
            });
        }).reduce((acc, cur) => acc.concat(cur), []);

        return (
            <svg
                width={ scaleFactor * mapWidth }
                height={ scaleFactor * mapHeight }
                onClick={ () => this.onClick() }
                onMouseMove={ (e) => this.onMouseMove(e) }>
                <g transform="translate(0, 0)">
                    <rect
                        x={ 0 }
                        y={ 0 }
                        width={ mapWidth * scaleFactor }
                        height={ mapHeight * scaleFactor }
                        style={{ fill: "blue", }}
                        />
                    <Land mapData={ mapData } scaleFactor={ scaleFactor } />
                    { objects }
                    { enableSelection ? (
                        <React.Fragment>
                            <circle
                                cx={ x * scaleFactor + scaleFactor/2 }
                                cy={ y * scaleFactor + scaleFactor/2 }
                                r={ scaleFactor }
                                style={{ fill: 'transparent', stroke: 'white', }}
                                />
                            { toolMode === ToolMode.PLACE_BOUY ? (
                                <React.Fragment>
                                    <line
                                        x1={ x * scaleFactor }
                                        y1={ y * scaleFactor + scaleFactor/2 }
                                        x2={ x * scaleFactor + scaleFactor }
                                        y2={ y * scaleFactor + scaleFactor/2 }
                                        style={{ stroke: "white" }}
                                        />
                                    <line
                                        x1={ x * scaleFactor + scaleFactor/2 }
                                        y1={ y * scaleFactor }
                                        x2={ x * scaleFactor + scaleFactor/2 }
                                        y2={ y * scaleFactor + scaleFactor }
                                        style={{ stroke: "white" }}
                                        />
                                </React.Fragment>
                            ) : null }
                            { toolMode === ToolMode.DROP_DEPTH_CHARGE ? (
                                <React.Fragment>
                                    <circle
                                        cx={ x * scaleFactor + scaleFactor/2 }
                                        cy={ y * scaleFactor + scaleFactor/2 }
                                        r={ scaleFactor / 2 }
                                        style={{ fill: 'red', stroke: 'red', }}
                                        />
                                </React.Fragment>
                            ) : null }
                        </React.Fragment>
                    ) : null }
                </g>
            </svg>
        );
    }
}

enum ClientState {
    CONNECTING,
    CONNECTED,
    WAITING_FOR_OPPONENT,
    MY_TURN,
    OPPONENTS_TURN,
}

interface Command {
    commandType: string;
}

interface ServerEvent {
    eventType: string;
}

interface AppState {
    clientState: ClientState;
    toolMode: ToolMode;
    playerId: number;
    gameId: string | null;
    mapWidth: number;
    mapHeight: number;
    mapData: number[][];
    tileState: Tile[][];
    selectedX: number;
    selectedY: number;
    selectedSubmarine: number;
}

class App extends Component<any, AppState> {
    websocket: WebSocket | null = null;

    constructor(props: any) {
        super(props);

        const hashMatch = window.location.hash.match(/^#join\/([a-z]+)$/);
        const gameId = hashMatch ? hashMatch[1] : null;

        this.state = {
            clientState: ClientState.CONNECTING,
            toolMode: ToolMode.SELECT_SHIP,
            playerId: 0,
            gameId,
            mapWidth: 0,
            mapHeight: 0,
            mapData: [],
            tileState: [],
            selectedX: -1,
            selectedY: -1,
            selectedSubmarine: 0,
        };
    }

    onConnected() {
        console.log("Connected to server");
        this.setState({
            clientState: ClientState.CONNECTED,
        });
    }

    onEvent(event: ServerEvent) {
        console.log(event);

        if (event.eventType === 'connected') {
            this.setState({
                playerId: (event as any).playerId,
            });
        } else if (event.eventType === 'game_created') {
            this.setState({
                clientState: ClientState.WAITING_FOR_OPPONENT,
                gameId: (event as any).gameId,
            });
        } else if (event.eventType === 'map') {
            const mapWidth = (event as any).width;
            const mapHeight = (event as any).height;
            const mapData = (event as any).map;
            this.setState({
                mapWidth,
                mapHeight,
                mapData,
            });
        } else if (event.eventType === 'state_update') {
            const { playerId } = this.state;

            const tileState = (event as any).map;
            const currentPlayer = (event as any).currentPlayer;
            const clientState = currentPlayer === playerId ? ClientState.MY_TURN : ClientState.OPPONENTS_TURN;
            this.setState({
                clientState,
                tileState,
                toolMode: ToolMode.SELECT_SHIP,
                selectedX: -1,
                selectedY: -1,
                selectedSubmarine: 0,
            });
        } else if (event.eventType === 'game_start') {
            const { playerId } = this.state;

            const firstPlayer = (event as any).firstPlayer;
            const clientState = firstPlayer === playerId ? ClientState.MY_TURN : ClientState.OPPONENTS_TURN;

            this.setState({
                clientState,
            });
        } else {
            this.setState({
                toolMode: ToolMode.SELECT_SHIP,
                selectedX: -1,
                selectedY: -1,
                selectedSubmarine: 0,
            });
        }
    }

    sendCommand<C extends Command>(command: C) {
        if (this.websocket === null) {
            return;
        }

        console.log("Sending command: ", command);

        this.websocket.send(JSON.stringify(command));
    }

    onStartGameClicked() {
        this.sendCommand({
            commandType: 'gameNew',
        });
    }

    onJoinGameClicked() {
        const { gameId } = this.state;

        this.sendCommand({
            commandType: 'gameJoin',
            gameId,
        });
    }

    onToolModeChange(toolMode: ToolMode) {
        console.log("toolMode is now: " , toolMode);
        this.setState({
            toolMode,
        });
    }

    onTileClick(x: number, y: number) {
        const { toolMode } = this.state;

        if (toolMode === ToolMode.DROP_DEPTH_CHARGE) {
            this.sendCommand({
                commandType: 'depthCharge',
                position: { x, y },
            });

            this.setState({
                clientState: ClientState.OPPONENTS_TURN,
            });
        } else if (toolMode === ToolMode.PLACE_BOUY) {
            this.sendCommand({
                commandType: 'bouy',
                position: { x, y },
            });
        } else if (toolMode === ToolMode.SELECT_SHIP) {
            const { tileState } = this.state;
            const tile = tileState[y].filter((tile) => tile.x === x).pop();
            if (tile && tile.t === 'submarine' && tile.id) {
                this.setState({
                    toolMode: ToolMode.MOVE_SHIP,
                    selectedX: x,
                    selectedY: y,
                    selectedSubmarine: tile.id,
                });
            }
        } else if (toolMode === ToolMode.MOVE_SHIP) {
            const { selectedSubmarine } = this.state;
            this.sendCommand({
                commandType: 'move',
                submarineId: selectedSubmarine,
                position: { x, y },
            });
        }
    }

    componentDidMount() {
        this.websocket = new WebSocket("ws://localhost:8080");
        this.websocket.addEventListener("open", () => this.onConnected());
        this.websocket.addEventListener("message", (event) => this.onEvent(JSON.parse(event.data)));
    }

    render() {
        const {
            clientState,
            playerId,
            gameId,
            mapWidth,
            mapHeight,
            mapData,
            toolMode,
            tileState,
            selectedX,
            selectedY,
            selectedSubmarine,
        } = this.state;

        let childComponent = null;
        if (clientState === ClientState.WAITING_FOR_OPPONENT) {
            childComponent = (
                <React.Fragment>
                    <h2>Waiting for opponent...</h2>

                    <div>
                        Send the following link to your chosen adversary:
                        <a href={ "http://localhost:3000/#join/" + gameId }>http://localhost:3000/#join/{ gameId }</a>
                    </div>
                </React.Fragment>
            );
        } else if (clientState === ClientState.CONNECTED) {
            childComponent = (
                <React.Fragment>
                    <h2>Connected!</h2>

                    {
                        gameId ? (
                            <button onClick={ () => this.onJoinGameClicked() }>Accept Game Invitation</button>
                        ) : null
                    }

                    <button onClick={ () => this.onStartGameClicked() }>Start New Game!</button>
                </React.Fragment>
            );
        } else if (clientState === ClientState.MY_TURN) {
            childComponent = (
                <React.Fragment>
                    <div>
                        <button onClick={ () => this.onToolModeChange(ToolMode.PLACE_BOUY) }>Place Bouy</button>
                        <button onClick={ () => this.onToolModeChange(ToolMode.DROP_DEPTH_CHARGE) }>Drop Depth Charge</button>
                    </div>
                    <GameBoard
                        playerId={ playerId }
                        mapWidth={ mapWidth }
                        mapHeight={ mapHeight }
                        mapData={ mapData }
                        tileState={ tileState }
                        enableSelection={ true }
                        toolMode={ toolMode }
                        selectedX={ selectedX }
                        selectedY={ selectedY }
                        onTileClick={ (x,y) => this.onTileClick(x,y) }
                        />
                </React.Fragment>
            );
        } else if (clientState === ClientState.OPPONENTS_TURN) {
            childComponent = (
                <React.Fragment>
                    <GameBoard
                        playerId={ playerId }
                        mapWidth={ mapWidth }
                        mapHeight={ mapHeight }
                        mapData={ mapData }
                        tileState={ tileState }
                        enableSelection={ false }
                        toolMode={ toolMode }
                        selectedX={ -1 }
                        selectedY={ -1 }
                        onTileClick={ (x,y) => {} }
                        />
                </React.Fragment>
            );
        } else {
            childComponent = (<h2>Connecting to server...</h2>);
        }

        return (
            <div className="App">
                <h1>SubSurface</h1>
                { childComponent }
            </div>
        );
    }
}

export default App;
