export interface MwMessage {
	params: ( parameters : unknown[] ) => this,
	parse: () => string
}

export interface MwI18n {
	Message: new( map : Map<string, string>, key : string, ...parameters ) => MwMessage,
	message: ( key : string, ...parameters ) => MwMessage,
	msg: ( key : string, ...parameters ) => string
}

export default function ( langCode: string, messageMap: Map<string, string> ) : MwI18n;
