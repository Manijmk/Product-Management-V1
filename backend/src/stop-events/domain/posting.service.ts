import { Injectable } from "@nestjs/common";

const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

@Injectable()
export class PostingService {
  lineCharge(price: number, quantity: number): number {
    return money(price * quantity);
  }

  damageCharge(rate: number, quantity: number): number {
    return money(rate * quantity);
  }
}
