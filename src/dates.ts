const DASHES = '[-–—―֊־~−]';
const weekTextNumericRegexp = new RegExp(`(\\d{1,2})\\/(\\d{1,2})\\s*${DASHES}\\s*(\\d{1,2})\\/(\\d{1,2})`);
const weekTextTwoMonthsRegexp = new RegExp(`([a-z]+)\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*${DASHES}\\s*([a-z]+)\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?`, 'i');
const weekTextOneMonthRegexp = new RegExp(`([a-z]+)\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*${DASHES}\\s*(\\d{1,2})(?:st|nd|rd|th)?`, 'i');

export function weekTextToWeek(weekText: string): Week {
    const numericMatch = weekTextNumericRegexp.exec(weekText);
    if (numericMatch) {
        const startMonth: Month = parseInt(numericMatch[1], 10) as Month;
        const startDay = parseInt(numericMatch[2], 10);
        const endMonth: Month = parseInt(numericMatch[3], 10) as Month;
        const endDay = parseInt(numericMatch[4], 10);

        return new Week(startMonth, startDay, endMonth, endDay);
    }

    const twoMonthsMatch = weekTextTwoMonthsRegexp.exec(weekText);
    if (twoMonthsMatch) {
        const startMonth = monthEnumMap.get(twoMonthsMatch[1].toLowerCase());
        const startDay = parseInt(twoMonthsMatch[2], 10);
        const endMonth = monthEnumMap.get(twoMonthsMatch[3].toLowerCase());
        const endDay = parseInt(twoMonthsMatch[4], 10);

        if (startMonth && endMonth) {
            return new Week(startMonth, startDay, endMonth, endDay);
        }
    }

    const oneMonthMatch = weekTextOneMonthRegexp.exec(weekText);
    if (oneMonthMatch) {
        const startMonth = monthEnumMap.get(oneMonthMatch[1].toLowerCase());
        const startDay = parseInt(oneMonthMatch[2], 10);
        const endMonth = startMonth;
        const endDay = parseInt(oneMonthMatch[3], 10);

        if (startMonth && endMonth) {
            return new Week(startMonth, startDay, endMonth, endDay);
        }
    }

    throw new Error(`Neither date scheme matched: "${weekText}"`);
}

export class Week {
    private readonly startMonth: Month;
    private readonly startDay: number;
    private readonly endMonth: Month;
    private readonly endDay: number;

    constructor(startMonth: Month, startDay: number, endMonth: Month, endDay: number) {
        this.startMonth = startMonth;
        this.startDay = startDay;
        this.endMonth = endMonth;
        this.endDay = endDay;
    }

    static getDateText(month: Month, day: number): string {
        let monthString = `${month}`.padStart(2, '0');
        let dayString = `${day}`.padStart(2, '0');
        return `${monthString}/${dayString}`;
    }

    getStartDateString(): string {
        return Week.getDateText(this.startMonth, this.startDay);
    }

    getEndDateString(): string {
        return Week.getDateText(this.endMonth, this.endDay);
    }
}

export enum Month {
    January = 1,
    February = 2,
    March = 3,
    April = 4,
    May = 5,
    June = 6,
    July = 7,
    August = 8,
    September = 9,
    October = 10,
    November = 11,
    December = 12,
}

// Convert text month name to enum
const monthEnumMap = new Map<string, Month>([
    ["jan", Month.January],
    ["january", Month.January],
    ["feb", Month.February],
    ["february", Month.February],
    ["mar", Month.March],
    ["march", Month.March],
    ["apr", Month.April],
    ["april", Month.April],
    ["may", Month.May],
    ["jun", Month.June],
    ["june", Month.June],
    ["jul", Month.July],
    ["july", Month.July],
    ["aug", Month.August],
    ["august", Month.August],
    ["sep", Month.September],
    ["sept", Month.September],
    ["september", Month.September],
    ["oct", Month.October],
    ["october", Month.October],
    ["nov", Month.November],
    ["november", Month.November],
    ["dec", Month.December],
    ["december", Month.December],
]);
