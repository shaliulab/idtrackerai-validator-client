// export class RequestQueue {
//   constructor(maxSimultaneousRequests) {
//     this.maxSimultaneousRequests = maxSimultaneousRequests;
//     this.currentRequests = 0;
//     this.queue = [];
//   }

//   async add(request) {
//     return new Promise((resolve, reject) => {
//       this.queue.push({ request, resolve, reject });

//       this.process();
//     });
//   }

//   process() {
//     while (this.currentRequests < this.maxSimultaneousRequests && this.queue.length) {
//       const { request, resolve, reject } = this.queue.shift();

//       this.currentRequests++;

//       request()
//         .then(resolve)
//         .catch(reject)
//         .finally(() => {
//           this.currentRequests--;
//           this.process();
//         });
//     }
//   }
// }


export class RequestQueue {
  constructor(maxSimultaneousRequests) {
    this.maxSimultaneousRequests = maxSimultaneousRequests;
    this.pendingRequests = [];
  }

  add(request) {
    return new Promise((resolve, reject) => {
      const interval = setInterval(() => {
        if (this.pendingRequests.length < this.maxSimultaneousRequests) {
          this.pendingRequests.push(request);
          clearInterval(interval);
          resolve(request());
        }
      }, 0);
    });
  }

  cancelAll() {
    if (this.pendingRequests.length > 5) {
      for (let request of this.pendingRequests.slice(Math.max(5, this.pendingRequests.length), this.pendingRequests.length)) {
        request.cancel();
      }
      this.pendingRequests.clear();
    }

  }
}