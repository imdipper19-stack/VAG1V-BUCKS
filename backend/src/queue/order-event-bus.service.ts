import { Injectable } from '@nestjs/common';
import { Subject, Observable, filter } from 'rxjs';
import { StepEvent } from './interfaces/step-event.interface';

@Injectable()
export class OrderEventBus {
  private readonly subject = new Subject<StepEvent>();

  emit(event: StepEvent): void {
    this.subject.next(event);
  }

  subscribe(orderId: string): Observable<StepEvent> {
    return this.subject.asObservable().pipe(
      filter((event) => event.orderId === orderId),
    );
  }
}
