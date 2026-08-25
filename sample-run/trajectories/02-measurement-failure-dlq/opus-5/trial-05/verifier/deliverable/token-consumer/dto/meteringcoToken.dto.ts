import { MeteringCoTokenMetadata } from './MeteringCoTokenMetadata';

export class MeteringCoToken {
    businessID: string;
    tokenAmount: string;
    subject?: string;
    metadata?: MeteringCoTokenMetadata;
    timestamp?: string;
    constructor(meteringcoToken: MeteringCoToken) {
        if (meteringcoToken) {
            this.businessID = meteringcoToken.businessID;
            this.tokenAmount = meteringcoToken.tokenAmount;
            if (meteringcoToken.metadata) {
                this.metadata = meteringcoToken.metadata;
            }
            if (meteringcoToken.subject) {
                this.subject = meteringcoToken.subject;
            }
            if (meteringcoToken.timestamp) {
                this.timestamp = meteringcoToken.timestamp;
            } else {
                this.timestamp = new Date().toISOString();
            }
        }
    }
}
