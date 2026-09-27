import { Batch } from "./model";
export type DriveFile = {
    id: string;
    name: string;
};
export interface DriveTransport {
    list(): Promise<DriveFile[]>;
    download(file: DriveFile): Promise<Batch>;
    upload(id: string, body: string): Promise<string>;
}
export declare class GoogleDrive implements DriveTransport {
    private token;
    readonly prefix: string;
    private parseBatch;
    constructor(token: () => Promise<string>, prefix: string, parseBatch: (text: string) => Batch);
    private call;
    list(): Promise<DriveFile[]>;
    download(file: DriveFile): Promise<Batch>;
    upload(id: string, body: string): Promise<string>;
}
