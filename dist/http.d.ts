export declare class ReconnectRequired extends Error {
    constructor();
}
export declare function request(url: string, init?: RequestInit): Promise<Response>;
export declare function checkResponse(response: Response): Promise<Response>;
