import http2 from 'http2';
import uuid from 'uuid/v4'

import config from './config.json';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
process.on('uncaughtException', console.error);

const {
  HTTP2_HEADER_METHOD,
  HTTP2_HEADER_PATH,
  HTTP2_HEADER_STATUS,
  HTTP2_HEADER_CONTENT_TYPE,
  HTTP2_HEADER_USER_AGENT,
  HTTP2_HEADER_COOKIE
} = http2.constants;

const TRACE_ID = 'X-TRACE-ID';
const PATH_TRACE_ID = 'X-PATH-TRACE-ID';
const PAIR_TRACE_ID = 'X-PAIR-TRACE-ID';
const PTP_TRACE_ID = 'X-PTP-TRACE-ID';
const POINT_TRACE_ID = 'X-POINT-TRACE-ID';

const TYPE_HTTP = 'http';
const TYPE_CODE = 'code';

const HTTP_DIRECTION_IN = 'in';
const HTTP_DIRECTION_OUT = 'out';
const HTTP_TYPE_RESPONSE = 'response';
const HTTP_TYPE_REQUEST = 'request';

console.log('init');

class MSTracer {
  constructor({service, node}) {
    this.service = service;
    this.node = node;

    this.LEVEL = {
      INFO: 'info',
      ERROR: 'error'
    }
  }

  intercept(server) {
    // this.server = server;

    server.on('stream', (stream, headers, flags) => {
      //TODO: log only with X-TRACE header requests
      if (!headers[TRACE_ID]) {
        const traceId = uuid();
        const pathTraceId = uuid();
        const pairTraceId = uuid();
        const ptpTraceId = uuid();
        // const pTraceId = uuid();

        stream._traceHeaders = {
          [TRACE_ID]: traceId,
          [PATH_TRACE_ID]: pathTraceId,
          [PAIR_TRACE_ID]: pairTraceId,
          [PTP_TRACE_ID]: ptpTraceId,
          // [POINT_TRACE_ID]: pTraceId
        };

        console.log(444, headers[HTTP2_HEADER_CONTENT_TYPE]);

        this.log({
          record: {
            pTraceId: uuid(),
            type: TYPE_HTTP,
            httpDirection: HTTP_DIRECTION_OUT,
            httpType: HTTP_TYPE_REQUEST,
            httpPath: headers[HTTP2_HEADER_PATH],
            httpMethod: headers[HTTP2_HEADER_METHOD],
            // httpBody: "{secret: '21312-31231-12312313123'}",
            httpUA: headers[HTTP2_HEADER_USER_AGENT],
            httpCookie: headers[HTTP2_HEADER_COOKIE],
            service: '__INIT__',
            traceId,
            pathTraceId,
            pairTraceId,
            ptpTraceId
          }
        });

        this.log({
          record: {
            pTraceId: uuid(),
            type: TYPE_HTTP,
            httpDirection: HTTP_DIRECTION_IN,
            httpType: HTTP_TYPE_REQUEST,
            httpPath: headers[HTTP2_HEADER_PATH],
            httpMethod: headers[HTTP2_HEADER_METHOD],
            // httpBody: "{secret: '21312-31231-12312313123'}",
            httpUA: headers[HTTP2_HEADER_USER_AGENT],
            httpCookie: headers[HTTP2_HEADER_COOKIE],
            traceId,
            pathTraceId,
            pairTraceId,
            ptpTraceId
          }
        });
      }

      console.log('request', headers[HTTP2_HEADER_PATH]);

      stream.on('data', (a, b, c) => {
        console.log('data:' + a)
      });

      stream.on('end', (a, b, c) => {
        console.log('end', a, b, c)
      });

      /*
        End of write (response).
       */
      stream.on('finish', (a, b, c) => {
        console.log('finish', headers);
        console.log(stream.constructor)



        // stream._readableState.on('data', (a, b, c) => {
        //   console.log('data', a, b, c);
        //   // console.log(stream);
        // });
      });

      stream.on('streamClosed', (a, b, c) => {
        console.log('streamClosed', a, b, c)
      });

      const old = stream.respond;
      stream.respond = (d) => {
        //TODO: based on content-type, record a response

        stream._contentType = d[HTTP2_HEADER_CONTENT_TYPE];
        stream._httpCode = d[HTTP2_HEADER_STATUS];

        return old.call(stream, d);
      };

      const oldWrite = stream._write;
      stream._write = (...args) => {
        console.log('r', args);

        let record = {
          pTraceId: uuid(),
          type: TYPE_HTTP,
          httpDirection: HTTP_DIRECTION_IN,
          httpType: HTTP_TYPE_RESPONSE,
          httpResponse: stream._contentType === 'application/json' ? args[0] : null,
          httpCode: stream._httpCode,
          httpPath: headers[HTTP2_HEADER_PATH],
          httpMethod: headers[HTTP2_HEADER_METHOD],
          httpCookie: headers[HTTP2_HEADER_COOKIE],
          ptpTraceId: uuid()
        };
        const traceInfo = this.getTraceInfoFromStream(stream);
        record = {...traceInfo, ...record};

        this.log({
          record: record
        });

        const recordInit = {
          ...record, ...{
            pTraceId: uuid(),
            service: '__INIT__',
            httpDirection: 'out'
          }
        };

        this.log({
          record: recordInit
        });

        return oldWrite.apply(stream, args);
      }

      const oldEnd = stream.end;
      stream.end = (...args) => {
        console.log('eeeeee!!!!!!!!!!!!!!', args);

        return oldEnd.apply(stream, args);
      }
    });
  }

  log({record, stream}) {
    const mstracerSession = http2.connect(config.mstracerAPI);
    // mstracerSession.on('connect', (error) => {

    record.service = record.service || this.service;

    if (record.reference) {
      record.reference = record.reference.stack.split('\n')[1];
    }

    if (stream) {
      if (!record.type) {
        record.type = TYPE_CODE;

        const traceInfo = this.getTraceInfoFromStream(stream);

        record = {...record, ...traceInfo};
      }
    }

    record.timestamp = +new Date();
    record.node = this.node;

    const request = mstracerSession.request({
      [HTTP2_HEADER_METHOD]: 'PUT',
      [HTTP2_HEADER_PATH]: '/log'
    });
    request.setEncoding('utf8');


    request.on('response', (headers) => {
      console.log(headers[HTTP2_HEADER_STATUS]);
    });

    request.on('data', (chunk) => {
      console.log('_d', chunk);
    });
    request.on('end', () => {
      console.log('_e');
    });
    request.on('error', (error) => {
      console.log('_error', error);
    });

    request.on('headers', (headers, flags) => {
      console.log('_headers', headers);
    });

    request.on('push', (headers, flags) => {
      console.log('_push', headers);
    });

    request.end(JSON.stringify(record));
    // });

    console.log('sessionType', mstracerSession.type, http2.constants.NGHTTP2_SESSION_CLIENT);


    // });
  }

  getTraceInfoFromStream(stream) {
    const headers = stream._traceHeaders;

    return {
      traceId: headers[TRACE_ID],
      pathTraceId: headers[PATH_TRACE_ID],
      pairTraceId: headers[PAIR_TRACE_ID],
      ptpTraceId: headers[PTP_TRACE_ID],
      // pTraceId: headers[POINT_TRACE_ID]
    }
  }

}

export default MSTracer;
