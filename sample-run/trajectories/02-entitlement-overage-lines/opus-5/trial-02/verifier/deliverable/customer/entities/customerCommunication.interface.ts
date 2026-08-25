export type CustomerCommunicationResponse = {
    message: string;
    id: string;
    data: Array<any>;
};

export enum CustomerCommunicationChannel {
    EMAIL = 'EMAIL',
}

export type CustomerCommunicationEmail = {
    subject: string;
    fromName: string;
    fromEmail: string;
    toEmail: string;
    content: string;
    replyToName: string;
    replyToEmail: string;
    html?: boolean;
};

export type CustomerCommunicationPublishRequest = {
    message: string;
    topic: CustomerCommunicationChannel;
    data: Array<CustomerCommunicationEmail>;
};
export interface CustomerCommunicationProcessor {
    process: (auditPublishRequest: CustomerCommunicationPublishRequest) => void;
}

export interface CustomerCommunication {
    publish: (publishRequest: CustomerCommunicationPublishRequest) => CustomerCommunicationResponse;
    subscribe: (auditLevel: CustomerCommunicationChannel, processor: CustomerCommunicationProcessor) => void;
}
